declare module "@capacitor/core" {
  export const Capacitor: {
    isNativePlatform(): boolean;
    getPlatform(): string;
  };
}

declare module "@capacitor/filesystem" {
  export enum Directory {
    Cache = "CACHE",
    Documents = "DOCUMENTS",
  }
  export const Filesystem: {
    writeFile(options: { path: string; data: string; directory: Directory }): Promise<{ uri: string }>;
  };
}

declare module "@capacitor/share" {
  export const Share: {
    share(options: { title?: string; url?: string }): Promise<unknown>;
  };
}
