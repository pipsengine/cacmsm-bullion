import React from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="appShell" style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <div className="appShellMain" style={{ flex: 1, minWidth: 0 }}>
        <Topbar />
        <main className="appShellContent" style={{ padding: 20 }}>{children}</main>
      </div>
    </div>
  );
}

