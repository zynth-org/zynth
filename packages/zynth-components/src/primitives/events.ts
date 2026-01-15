export type KeyEvent = {
  key: string;
  code?: string;
  repeat?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  modifiers?: {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
  };
};

export type Modifiers = KeyEvent["modifiers"];
