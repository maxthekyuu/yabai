#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <arpa/inet.h>

#define PREFIX_MAX_MESSAGE (1024 * 1024)
static int prefix_address(struct sockaddr_un *address, const char *token)
{
    if (!*token || strlen(token) > 48 || strspn(token, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-.") != strlen(token)) return 0;
    memset(address, 0, sizeof(*address)); address->sun_family = AF_UNIX;
    snprintf(address->sun_path, sizeof(address->sun_path), "/tmp/yabai-prefix-%u-%s.sock", getuid(), token);
    return 1;
}
static int prefix_io(int fd, void *buffer, size_t length, int writing)
{
    char *p = buffer;
    while (length) {
        ssize_t n = writing ? write(fd, p, length) : read(fd, p, length);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return 0;
        p += n; length -= n;
    }
    return 1;
}
static void prefix_timeout(int fd)
{
    struct timeval timeout = { .tv_sec = 1 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    int yes = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
}
