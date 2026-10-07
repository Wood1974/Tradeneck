import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.tradedeck.shield",
  appName: "Shield",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
