declare module "@capacitor/core" {
  export const Capacitor: {
    isNativePlatform(): boolean;
    getPlatform(): string;
  };
}

declare module "@capacitor/camera" {
  export enum CameraResultType {
    Uri = "uri",
    Base64 = "base64",
    DataUrl = "dataUrl",
  }
  export enum CameraSource {
    Prompt = "PROMPT",
    Camera = "CAMERA",
    Photos = "PHOTOS",
  }
  export enum CameraDirection {
    Rear = "REAR",
    Front = "FRONT",
  }
  export const Camera: {
    getPhoto(options: {
      source: CameraSource;
      resultType: CameraResultType;
      quality?: number;
      allowEditing?: boolean;
      correctOrientation?: boolean;
      direction?: CameraDirection;
    }): Promise<{ base64String?: string; format?: string }>;
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
