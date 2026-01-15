import { Image, type ImageProps } from "./Image";
import { type Component, splitProps } from "solid-js";

export interface SystemIconProps extends Omit<ImageProps, "source"> {
  name: string;
}

export const SystemIcon: Component<SystemIconProps> = (props) => {
  const [local, others] = splitProps(props, ["name"]);
  return <Image source={{ system: local.name }} {...others} />;
};
