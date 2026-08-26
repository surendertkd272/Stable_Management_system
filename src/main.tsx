import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ThemeProvider } from "./theme";
import { StableProvider, ToastProvider } from "./store";
import { AuthProvider } from "./auth";
import "./index.css";

// AuthProvider wraps StableProvider deliberately: the store starts polling the
// API on mount, so it must not run until we know whether we have a session.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <StableProvider>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </StableProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
