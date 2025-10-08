import Docker from "dockerode";

type DockerClientOptions = {
  socketPath?: string;
};

function createDockerClient(options: DockerClientOptions = {}) {
  const socketPath = options.socketPath ?? process.env.SKYHOOK_DOCKER_SOCKET ?? "/var/run/docker.sock";
  return new Docker({ socketPath });
}

export { createDockerClient };
