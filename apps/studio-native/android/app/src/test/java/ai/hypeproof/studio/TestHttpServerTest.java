package ai.hypeproof.studio;

import static org.junit.Assert.*;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;

/**
 * The loopback test server itself. CI run 44698226192 failed ReflectionStopTest because a
 * connection closed before its request line made the server index an empty split.
 */
public final class TestHttpServerTest {
    private static final byte[] GET = "GET /ok HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".getBytes(StandardCharsets.US_ASCII);

    private static String exchange(TestHttpServer server, byte[] request) throws Exception {
        URI uri = URI.create(server.url());
        try (Socket socket = new Socket(uri.getHost(), uri.getPort())) {
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(request);
            socket.getOutputStream().flush();
            socket.shutdownOutput();
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.US_ASCII);
        }
    }

    private static TestHttpServer server(AtomicInteger handled) throws Exception {
        return new TestHttpServer(r -> {
            handled.incrementAndGet();
            r.respond(200, "text/plain", r.path.getBytes(StandardCharsets.US_ASCII), "");
        });
    }

    // The accept loop is sequential, so a later answered request proves the earlier
    // connection was accepted; close() then waits for its worker before check().
    @Test public void connectionClosedBeforeRequestLineIsDroppedNotFailed() throws Exception {
        AtomicInteger handled = new AtomicInteger();
        TestHttpServer server = server(handled);
        assertEquals("", exchange(server, new byte[0]));
        assertTrue(exchange(server, GET).endsWith("/ok"));
        server.close();
        assertEquals(1, handled.get());
    }

    @Test public void bareLineEndingBeforeCloseIsDroppedNotFailed() throws Exception {
        AtomicInteger handled = new AtomicInteger();
        TestHttpServer server = server(handled);
        assertEquals("", exchange(server, "\r\n".getBytes(StandardCharsets.US_ASCII)));
        assertTrue(exchange(server, GET).endsWith("/ok"));
        server.close();
        assertEquals(1, handled.get());
    }

    // Negative control: the fix must not hide a client that sends a broken request.
    @Test public void malformedRequestLineStillFailsTheServer() throws Exception {
        AtomicInteger handled = new AtomicInteger();
        TestHttpServer server = server(handled);
        exchange(server, "GARBAGE\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
        assertTrue(exchange(server, GET).endsWith("/ok"));
        AssertionError error = assertThrows(AssertionError.class, server::close);
        assertTrue(String.valueOf(error.getCause()), error.getCause() instanceof IllegalStateException);
        assertEquals(1, handled.get());
    }

    @Test public void endOfStreamIsAClosedConnection() {
        assertThrows(EOFException.class, () -> new TestHttpServer.Request(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream()));
    }
}
