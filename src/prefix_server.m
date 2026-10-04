#include "prefix_socket.h"
#include <fcntl.h>

static int prefix_serve(const char *token)
{
    pid_t parent = getppid();
    if (parent == 1) return 1;
    struct sockaddr_un address;
    if (!prefix_address(&address, token)) return 1;
    int listener = socket(AF_UNIX, SOCK_STREAM, 0);
    if (listener < 0) return 1;
    mode_t mask = umask(0077);
    int bound = bind(listener, (struct sockaddr *)&address, sizeof(address));
    umask(mask);
    if (bound != 0 || chmod(address.sun_path, 0600) != 0 || listen(listener, 8) != 0) { close(listener); return 1; }
    fcntl(listener, F_SETFL, O_NONBLOCK);
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    if (getppid() != parent) { close(listener); unlink(address.sun_path); return 1; }
    __block PrefixMenuPanel *panel = nil;
    NSMutableArray *hints = [NSMutableArray array];
    __block NSDictionary *previous = nil;
    __block BOOL visible = NO;
    __block unsigned long long revision = 0;
    menu_hidden = YES;
    dispatch_queue_t queue = dispatch_queue_create("org.yabai.prefix.socket", DISPATCH_QUEUE_SERIAL);
    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_READ, listener, 0, queue);
    dispatch_source_set_event_handler(source, ^{
        int fd;
        while ((fd = accept(listener, NULL, NULL)) >= 0) {
            @autoreleasepool {
                prefix_timeout(fd);
                uid_t uid; gid_t gid;
                uint32_t size;
                if (getpeereid(fd, &uid, &gid) || uid != getuid() || !prefix_io(fd, &size, sizeof(size), 0) ||
                    !(size = ntohl(size)) || size > PREFIX_MAX_MESSAGE) { close(fd); continue; }
                NSMutableData *data = [NSMutableData dataWithLength:size];
                if (!prefix_io(fd, data.mutableBytes, size, 0)) { close(fd); continue; }
                id message = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
                __block BOOL accepted = NO, reused = NO, quit = NO;
                __block double renderMS = 0;
                dispatch_sync(dispatch_get_main_queue(), ^{
                    if (![message isKindOfClass:NSDictionary.class]) return;
                    NSString *action = message[@"action"];
                    if ([action isEqual:@"quit"]) { accepted = YES; quit = YES; return; }
                    NSNumber *seq = message[@"revision"];
                    if (![seq isKindOfClass:NSNumber.class] || seq.unsignedLongLongValue < revision) return;
                    revision = seq.unsignedLongLongValue;
                    if ([action isEqual:@"hide"]) {
                        visible = NO; menu_hidden = YES;
                        [panel orderOut:nil]; for (NSWindow *hint in hints) [hint orderOut:nil];
                        accepted = YES; return;
                    }
                    if ([action isEqual:@"stats"]) { accepted = YES; return; }
                    if (![@[@"show", @"prepare", @"update"] containsObject:action]) return;
                    NSDictionary *payload = message[@"payload"] ?: previous;
                    if (![payload isKindOfClass:NSDictionary.class] || has_search(payload)) return;
                    BOOL nextVisible = ![action isEqual:@"prepare"];
                    menu_hidden = !nextVisible;
                    reused = [previous isEqual:payload];
                    if (!reused) {
                        double start = CFAbsoluteTimeGetCurrent();
                        if (render_menu(payload, nil, panel, hints, &panel) != 0) { menu_hidden = !visible; return; }
                        renderMS = (CFAbsoluteTimeGetCurrent()-start)*1000;
                        previous = [payload copy];
                    }
                    visible = nextVisible;
                    if (visible) {
                        [panel orderFrontRegardless]; [panel displayIfNeeded];
                        for (NSWindow *hint in hints) { [hint orderFrontRegardless]; [hint displayIfNeeded]; }
                    } else {
                        [panel orderOut:nil]; for (NSWindow *hint in hints) [hint orderOut:nil];
                    }
                    accepted = YES;
                });
                char reply[256];
                int count = snprintf(reply, sizeof(reply), "{\"accepted\":%s,\"visible\":%s,\"reused\":%s,\"render_ms\":%.3f}\n", accepted?"true":"false", visible?"true":"false", reused?"true":"false", renderMS);
                prefix_io(fd, reply, count, 1); close(fd);
                if (quit) { unlink(address.sun_path); exit(0); }
            }
        }
    });
    dispatch_resume(source);
    // Phoenix owns this process. Its exit also removes the private socket.
    dispatch_source_t owner = dispatch_source_create(DISPATCH_SOURCE_TYPE_PROC, parent, DISPATCH_PROC_EXIT, dispatch_get_main_queue());
    NSString *path = [NSString stringWithUTF8String:address.sun_path];
    dispatch_source_set_event_handler(owner, ^{ unlink(path.fileSystemRepresentation); exit(0); });
    dispatch_resume(owner);
    dispatch_source_t stop = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
    signal(SIGTERM, SIG_IGN);
    dispatch_source_set_event_handler(stop, ^{ unlink(path.fileSystemRepresentation); exit(0); });
    dispatch_resume(stop);
    [NSApp run];
    dispatch_source_cancel(source); dispatch_source_cancel(owner); dispatch_source_cancel(stop);
    close(listener); unlink(address.sun_path);
    return 0;
}
