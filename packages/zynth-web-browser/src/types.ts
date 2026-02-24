export type OpenBrowserOptions = {
  url: string;
  preferEphemeralSession?: boolean;
  toolbarColor?: string;
  controlsColor?: string;
  showTitle?: boolean;
  enableBarCollapsing?: boolean;
  createTask?: boolean;
};

export type WebBrowserResultType = "opened" | "cancel" | "dismiss" | "error";

export type WebBrowserResult = {
  type: WebBrowserResultType;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
};

export type WebBrowserDismissResult = {
  dismissed: boolean;
};
