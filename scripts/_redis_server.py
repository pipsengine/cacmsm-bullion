from __future__ import annotations

import socket
import threading
import time
from typing import Any

from fakeredis import FakeRedis


r = FakeRedis(decode_responses=True, version=(7, 0, 0), thread_safe=True)


class RESPParser:
    _INCOMPLETE = object()

    def __init__(self, data: bytes = b""):
        self._buf = bytearray(data)
        self._pos = 0

    def feed(self, data: bytes) -> None:
        tail = bytes(self._buf[self._pos:])
        self._buf = bytearray(tail) + bytearray(data)
        self._pos = 0

    def _read_line(self) -> bytes | None:
        idx = self._buf.find(b"\r\n", self._pos)
        if idx == -1:
            return None
        line = bytes(self._buf[self._pos:idx])
        self._pos = idx + 2
        return line

    def parse(self) -> list[Any] | None:
        if self._pos >= len(self._buf):
            return None
        prefix = self._buf[self._pos:self._pos + 1]
        if prefix == b"*":
            self._pos += 1
            arr = self._parse_array()
            if arr is RESPParser._INCOMPLETE:
                return None
            return arr
        one = self._parse_one()
        if one is RESPParser._INCOMPLETE:
            return None
        return [one]

    def _parse_one(self) -> Any:
        if self._pos >= len(self._buf):
            return RESPParser._INCOMPLETE
        t = self._buf[self._pos:self._pos + 1]
        self._pos += 1
        if t == b"+":
            line = self._read_line()
            if line is None:
                return RESPParser._INCOMPLETE
            return line.decode()
        if t == b"-":
            line = self._read_line()
            if line is None:
                return RESPParser._INCOMPLETE
            return ("error", line.decode())
        if t == b":":
            line = self._read_line()
            if line is None:
                return RESPParser._INCOMPLETE
            return int(line.decode())
        if t == b"$":
            line = self._read_line()
            if line is None:
                return RESPParser._INCOMPLETE
            try:
                length = int(line.decode())
            except ValueError:
                return RESPParser._INCOMPLETE
            if length == -1:
                return None
            needed = self._pos + length + 2
            if needed > len(self._buf):
                return RESPParser._INCOMPLETE
            data = bytes(self._buf[self._pos:self._pos + length])
            self._pos += length + 2
            return data.decode()
        if t == b"*":
            return self._parse_array()
        if t == b"%":
            return self._parse_map()
        return RESPParser._INCOMPLETE

    def _parse_array(self) -> list[Any] | object:
        count_line = self._read_line()
        if count_line is None:
            return RESPParser._INCOMPLETE
        try:
            count = int(count_line.decode())
        except ValueError:
            return RESPParser._INCOMPLETE
        if count == -1:
            return []
        result: list[Any] = []
        for _ in range(count):
            item = self._parse_one()
            if item is RESPParser._INCOMPLETE:
                return RESPParser._INCOMPLETE
            result.append(item)
        return result

    def _parse_map(self) -> dict[Any, Any] | object:
        count_line = self._read_line()
        if count_line is None:
            return RESPParser._INCOMPLETE
        try:
            count = int(count_line.decode())
        except ValueError:
            return RESPParser._INCOMPLETE
        if count < 0:
            return {}
        result: dict[Any, Any] = {}
        for _ in range(count):
            k = self._parse_one()
            if k is RESPParser._INCOMPLETE:
                return RESPParser._INCOMPLETE
            v = self._parse_one()
            if v is RESPParser._INCOMPLETE:
                return RESPParser._INCOMPLETE
            result[k] = v
        return result


def encode_resp(value: Any, *, protocol: int = 3) -> bytes:
    if value is None:
        if protocol >= 3:
            return b"_\r\n"
        return b"$-1\r\n"
    if isinstance(value, bool):
        return b"+OK\r\n" if value else b"+QUEUED\r\n"
    if isinstance(value, int):
        return f":{value}\r\n".encode()
    if isinstance(value, str):
        encoded = value.encode()
        return b"$" + str(len(encoded)).encode() + b"\r\n" + encoded + b"\r\n"
    if isinstance(value, bytes):
        return b"$" + str(len(value)).encode() + b"\r\n" + value + b"\r\n"
    if isinstance(value, list):
        out = b"*" + str(len(value)).encode() + b"\r\n"
        for item in value:
            out += encode_resp(item, protocol=protocol)
        return out
    if isinstance(value, tuple):
        return encode_resp(list(value), protocol=protocol)
    if isinstance(value, dict):
        if protocol >= 3:
            out = b"%" + str(len(value)).encode() + b"\r\n"
            for k, v in value.items():
                out += encode_resp(k, protocol=protocol)
                out += encode_resp(v, protocol=protocol)
            return out
        else:
            flat = []
            for k, v in value.items():
                flat.append(k)
                flat.append(v)
            return encode_resp(flat, protocol=2)
    return encode_resp(str(value), protocol=protocol)


def encode_error(msg: str) -> bytes:
    return f"-ERR {msg}\r\n".encode()


def _xadd(args: list[str]) -> Any:
    stream = args[0]
    i = 1
    maxlen = None
    approximate = False
    while i < len(args) and args[i].upper() in ("MAXLEN",):
        if args[i].upper() == "MAXLEN":
            i += 1
            if i < len(args) and args[i] == "~":
                approximate = True
                i += 1
            maxlen = int(args[i])
            i += 1
    rid = args[i]
    i += 1
    fields: dict[str, str] = {}
    while i + 1 < len(args):
        fields[args[i]] = args[i + 1]
        i += 2
    kwargs = {}
    if maxlen is not None:
        kwargs["maxlen"] = maxlen
        if approximate:
            kwargs["approximate"] = True
    return r.xadd(stream, fields, id=rid if rid != "*" else "*", **kwargs)


def _xread(args: list[str]) -> Any:
    count = None
    block = None
    i = 0
    while i < len(args):
        a = args[i].upper()
        if a == "COUNT":
            count = int(args[i + 1])
            i += 2
        elif a == "BLOCK":
            block = int(args[i + 1])
            i += 2
        elif a == "STREAMS":
            i += 1
            break
        else:
            i += 1
    remaining = args[i:]
    half = len(remaining) // 2
    keys = remaining[:half]
    ids = remaining[half:]
    streams = dict(zip(keys, ids))
    kwargs = {}
    if count is not None:
        kwargs["count"] = count
    if block is not None:
        kwargs["block"] = block
    result = r.xread(streams=streams, **kwargs) or []
    return result


def _xrange(args: list[str]) -> Any:
    key = args[0]
    start = args[1]
    end = args[2]
    count = None
    if len(args) > 3 and args[3].upper() == "COUNT":
        count = int(args[4])
    return r.xrange(key, min=start, max=end, count=count)


def _xrevrange(args: list[str]) -> Any:
    key = args[0]
    end = args[1]
    start = args[2]
    count = None
    if len(args) > 3 and args[3].upper() == "COUNT":
        count = int(args[4])
    return r.xrevrange(key, max=end, min=start, count=count)


def _flatten_stream_fields(obj: Any) -> Any:
    if isinstance(obj, dict):
        flat = []
        for k, v in obj.items():
            flat.append(k)
            flat.append(v)
        return flat
    if isinstance(obj, list):
        return [_flatten_stream_fields(x) for x in obj]
    if isinstance(obj, tuple):
        return [_flatten_stream_fields(x) for x in obj]
    return obj


def handle_command(cmd_parts: list[str]) -> bytes:
    if not cmd_parts:
        return encode_error("empty command")
    cmd = cmd_parts[0].upper()
    args = cmd_parts[1:]
    try:
        if cmd == "PING":
            return b"+PONG\r\n"
        if cmd == "COMMAND":
            return encode_resp([])
        if cmd == "HELLO":
            protover = 2
            i = 0
            while i < len(args):
                a = args[i].upper()
                if a.isdigit():
                    protover = max(2, min(3, int(a)))
                    i += 1
                elif a == "AUTH":
                    i += 3
                elif a == "SETNAME":
                    i += 2
                else:
                    i += 1
            response = {
                b"server": b"redis",
                b"version": b"7.0.0",
                b"proto": protover,
                b"id": 1,
                b"mode": b"standalone",
                b"role": b"master",
                b"modules": [],
            }
            return encode_resp(response, protocol=protover)
        if cmd == "GET":
            return encode_resp(r.get(args[0]))
        if cmd == "SET":
            ex = None
            px = None
            i = 2
            while i < len(args):
                a = args[i].upper()
                if a == "EX":
                    ex = int(args[i + 1])
                    i += 2
                elif a == "PX":
                    px = int(args[i + 1])
                    i += 2
                else:
                    i += 1
            kwargs = {}
            if ex:
                kwargs["ex"] = ex
            if px:
                kwargs["px"] = px
            r.set(args[0], args[1], **kwargs)
            return b"+OK\r\n"
        if cmd == "XADD":
            return encode_resp(_xadd(args))
        if cmd == "XREAD":
            result = _xread(args)
            # RESP3 XREAD format: MAP {stream_name: [entries]}
            # RESP2 format: ARRAY [[stream_name, [entries]], ...]
            # Convert list-of-lists format to dict for RESP3 encoding
            # Also flatten field dicts to alternating lists for legacy parsers
            flat_result = _flatten_stream_fields(result)
            if isinstance(flat_result, list):
                as_dict = {}
                for item in flat_result:
                    if isinstance(item, list) and len(item) == 2:
                        stream_name, entries = item
                        as_dict[stream_name] = entries
                return encode_resp(as_dict)
            return encode_resp(flat_result)
        if cmd == "XRANGE":
            return encode_resp(_flatten_stream_fields(_xrange(args)))
        if cmd == "XREVRANGE":
            return encode_resp(_flatten_stream_fields(_xrevrange(args)))
        if cmd == "XLEN":
            return encode_resp(r.xlen(args[0]))
        if cmd == "INFO":
            return encode_resp("# FakeRedis\r\nrole:master\r\n")
        if cmd == "SELECT":
            return b"+OK\r\n"
        if cmd == "AUTH":
            return b"+OK\r\n"
        if cmd == "CLIENT":
            sub = args[0].upper() if args else ""
            if sub == "SETINFO":
                return b"+OK\r\n"
            if sub == "GETNAME":
                return encode_resp(None)
            return b"+OK\r\n"
        if cmd == "CONFIG":
            return encode_resp([])
        if cmd == "READONLY":
            return b"+OK\r\n"
        if cmd == "READWRITE":
            return b"+OK\r\n"
        if cmd == "DEL":
            total = 0
            for key in args:
                try:
                    r.delete(key)
                    total += 1
                except Exception:
                    pass
            return encode_resp(total)
        if cmd == "UNLINK":
            total = 0
            for key in args:
                try:
                    r.delete(key)
                    total += 1
                except Exception:
                    pass
            return encode_resp(total)
        if cmd == "EXISTS":
            cnt = 0
            for key in args:
                try:
                    if r.exists(key):
                        cnt += 1
                except Exception:
                    pass
            return encode_resp(cnt)
        if cmd == "TYPE":
            try:
                t = r.type(args[0])
            except Exception:
                t = "none"
            return encode_resp(t or "none")
        if cmd == "KEYS":
            try:
                keys = list(r.keys(args[0]) or [])
            except Exception:
                keys = []
            return encode_resp(keys)
        if cmd == "FLUSHALL" or cmd == "FLUSHDB":
            try:
                r.flushall()
            except Exception:
                pass
            return b"+OK\r\n"
        if cmd == "MGET":
            out = []
            for key in args:
                try:
                    out.append(r.get(key))
                except Exception:
                    out.append(None)
            return encode_resp(out)
        if cmd == "HSET":
            key = args[0]
            mapping = {}
            i = 1
            while i + 1 < len(args):
                mapping[args[i]] = args[i + 1]
                i += 2
            if not mapping and len(args) >= 3:
                mapping[args[1]] = args[2]
            try:
                res = r.hset(key, mapping=mapping)
            except TypeError:
                for k, v in mapping.items():
                    r.hset(key, k, v)
                res = len(mapping)
            return encode_resp(int(res or len(mapping)))
        if cmd == "HGET":
            return encode_resp(r.hget(args[0], args[1]))
        if cmd == "HGETALL":
            try:
                res = r.hgetall(args[0])
            except Exception:
                res = {}
            return encode_resp(dict(res) if res else {})
        if cmd == "INCR":
            try:
                val = r.incr(args[0])
            except Exception:
                r.set(args[0], 1)
                val = 1
            return encode_resp(int(val))
        return encode_error(f"unsupported command: {cmd}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        return encode_error(f"{type(e).__name__}: {e}")


def handle_client(conn: socket.socket, addr) -> None:
    try:
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    except Exception:
        pass
    parser = RESPParser()
    conn_id = f"[{addr[0]}:{addr[1]}]"
    try:
        import sys as _sys
        print(f"[redis-server] {conn_id} connected", flush=True)
        while True:
            try:
                chunk = conn.recv(65536)
            except Exception as recv_e:
                print(f"[redis-server] {conn_id} recv exception: {recv_e}", flush=True)
                break
            if not chunk:
                print(f"[redis-server] {conn_id} client closed connection", flush=True)
                break
            print(f"[redis-server] {conn_id} recv {len(chunk)} bytes", flush=True)
            parser.feed(chunk)
            while True:
                try:
                    parts = parser.parse()
                except Exception as pe:
                    import traceback
                    print(f"[redis-server] {conn_id} parser exception:", flush=True)
                    traceback.print_exc()
                    break
                if parts is None:
                    break
                if isinstance(parts, list) and parts and isinstance(parts[0], list):
                    parts = parts[0]
                cmd_preview = parts[:3] if isinstance(parts, list) else parts
                print(f"[redis-server] {conn_id} parsed command: {cmd_preview}", flush=True)
                try:
                    response = handle_command(parts)
                except Exception as ce:
                    import traceback
                    print(f"[redis-server] {conn_id} handler exception:", flush=True)
                    traceback.print_exc()
                    response = encode_error(f"internal: {type(ce).__name__}: {ce}")
                print(f"[redis-server] {conn_id} sending response {len(response)} bytes", flush=True)
                try:
                    conn.sendall(response)
                except Exception as send_e:
                    print(f"[redis-server] {conn_id} send exception: {send_e}", flush=True)
                    return
    except Exception as e:
        import traceback
        print(f"[redis-server] {conn_id} fatal exception:", flush=True)
        traceback.print_exc()
    finally:
        try:
            conn.close()
        except Exception:
            pass
        print(f"[redis-server] {conn_id} disconnected", flush=True)


def main() -> None:
    import sys
    host = "127.0.0.1"
    port = 16379
    try:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind((host, port))
        srv.listen(32)
    except OSError as e:
        print(f"[redis-server] FATAL: could not bind to {host}:{port}: {e}", flush=True)
        sys.exit(1)
    print(f"[redis-server] listening on {host}:{port} (FakeRedis-backed)", flush=True)
    try:
        while True:
            conn, addr = srv.accept()
            t = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            t.start()
    except KeyboardInterrupt:
        print("\n[redis-server] shutting down", flush=True)
    finally:
        srv.close()


if __name__ == "__main__":
    main()
