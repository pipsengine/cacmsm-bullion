import React from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="appShell">
      <Sidebar />
      <div className="appShellMain">
        <Topbar />
        <main className="appShellContent">{children}</main>
      </div>
    </div>
  );
}

