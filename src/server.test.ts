import assert from "node:assert/strict";
import { once } from "node:events";
import { Duplex } from "node:stream";
import test from "node:test";
import { createAppServer } from "./server.js";

test("um caminho sem rota recebe 404 sem redirecionamento nem cache", async () => {
  const chunks: Buffer[] = [];
  const connection = new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk);
      done();
    },
  });

  const finished = once(connection, "finish");
  createAppServer({ origin: "https://s.example", create: async () => "aBc1234", resolve: async () => null }).emit("connection", connection);
  connection.push("GET /caminho/inexistente HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  await finished;

  const headers = Buffer.concat(chunks).toString("latin1").split("\r\n\r\n")[0];
  assert.match(headers, /^HTTP\/1\.1 404 Not Found\r\n/);
  assert.match(headers, /^Cache-Control: no-store\r?$/im);
  assert.doesNotMatch(headers, /^Location:/im);
});
