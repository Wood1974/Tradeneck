import { registerPlugin } from "@capacitor/core";

export const SecureCapture = registerPlugin("SecureCapture", {
  web: () => import("./web.js").then((m) => new m.SecureCaptureWeb()),
});
