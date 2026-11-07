import type { Metadata } from "next";
import "./globals.css";
import "./cyberpunk.css";
import "./workspace.css";
import "./workspace-effects.css";
import "./experience.css";
import "./expressive-dynamics.css";
import "./warm-neon.css";
import "./chart-bars.css";
import { WorkspacePreferencesProvider } from "./workspace-preferences";
import { WorkspaceBackground } from "./workspace-background";
export const metadata: Metadata = { title: "Neonworth — Your money, clearly", description: "Your private personal finance dashboard. Cash flow, spending, savings and net worth, without the noise.", icons: {icon:"/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><head><link rel="preload" href="/fonts/space-grotesk-variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head><body><WorkspacePreferencesProvider><WorkspaceBackground/>{children}</WorkspacePreferencesProvider></body></html> }
