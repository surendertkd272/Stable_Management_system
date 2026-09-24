"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "../theme";
import { AuthProvider } from "../auth";
import { StableProvider, ToastProvider } from "../store";
import Layout from "../components/Layout";

// AuthProvider wraps StableProvider deliberately: the store starts polling the
// API on mount, so it must not run until we know whether we have a session.
// It also means nothing below renders until the session check finishes — on
// the server that is just a spinner, which is why reading localStorage in the
// store and screens is safe here.
export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <StableProvider>
          <ToastProvider>
            <Layout>{children}</Layout>
          </ToastProvider>
        </StableProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
