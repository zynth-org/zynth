import { Image, type ImageProps } from "./Image";
import { type Component, omit } from "solid-js";

export interface SystemIconProps extends Omit<ImageProps, "source"> {
  name: string;
}

export const SystemIcon: Component<SystemIconProps> = (props) => {
  const others = omit(props, "name" as keyof SystemIconProps);
  return <Image source={{ system: props.name }} {...others} />;
};
