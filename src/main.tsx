import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { FolioApp } from "@/components/folio/app";
import "@/styles.css";
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found");
}

createRoot(root).render(
  <StrictMode>
    <FolioApp />
    <Toaster theme="dark" position="bottom-center" richColors closeButton />
  </StrictMode>,
);
