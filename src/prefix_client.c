// Deliberately no Cocoa/Foundation dependency on the shortcut's critical path.
#include "prefix_socket.h"
int main(int argc, char **argv)
{
    struct sockaddr_un address;
    if (argc != 3 || !prefix_address(&address, argv[1])) return 1;
    size_t length = strlen(argv[2]);
    if (!length || length > PREFIX_MAX_MESSAGE) return 1;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) return 1;
    prefix_timeout(fd);
    struct timeval reply_timeout = { .tv_sec = 5 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &reply_timeout, sizeof(reply_timeout));
    // Only cold start/recovery waits for the resident server to bind.
    int connected = 0;
    for (int i = 0; i < 300; ++i) {
        if (connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0) { connected = 1; break; }
        if (errno != ENOENT && errno != ECONNREFUSED) break;
        usleep(10000);
    }
    if (!connected) { fprintf(stderr, "prefix connect: %s\n", strerror(errno)); close(fd); return 1; }
    uint32_t size = htonl((uint32_t)length);
    if (!prefix_io(fd, &size, sizeof(size), 1) || !prefix_io(fd, argv[2], length, 1)) { close(fd); return 1; }
    char response[512]; size_t used = 0;
    while (used < sizeof(response)-1) {
        ssize_t n = read(fd, response + used, sizeof(response)-1-used);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) break;
        used += n;
        if (memchr(response, '\n', used)) break;
    }
    close(fd);
    if (!used) { fprintf(stderr, "prefix acknowledgment missing or timed out\n"); return 1; }
    response[used] = 0; fputs(response, stdout);
    return strstr(response, "\"accepted\":true") ? 0 : 1;
}
