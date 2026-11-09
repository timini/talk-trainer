// The renderer: a container with LibreOffice and poppler (container/Dockerfile) that turns a deck into one PNG a
// slide. A Worker cannot run LibreOffice, so this is the one part of the build that runs in a container.
import { Container } from "@cloudflare/containers";

export class Render extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}
