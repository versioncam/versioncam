#!/usr/bin/env node
/**
 * Fails if anything still accepts a connection on a port.
 *
 * Every command that starts the app has to stop it again, and the port is what
 * the next command trips over, so the port is what gets asked. Both loopback
 * addresses, because a dev server binds whichever one `localhost` resolved to.
 *
 * Usage: node .github/scripts/port-free.mjs <port>
 */
import { connect } from "node:net";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("Usage: port-free.mjs <port>\n");
  process.exit(2);
}

/**
 * True when the address accepts a connection. Silence counts as no: on Windows
 * a refused connection is retried for about two seconds before it is reported,
 * so this waits longer than that rather than guessing from a short timeout.
 */
function answers(host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const hosts = ["127.0.0.1", "::1"];
const results = await Promise.all(hosts.map(answers));
const answering = hosts.filter((_, index) => results[index]);
if (answering.length > 0) {
  process.stderr.write(
    `Something still answers on port ${port} (${answering.join(", ")}).\n`,
  );
  process.exit(1);
}
process.stdout.write(`Nothing answers on port ${port}.\n`);
