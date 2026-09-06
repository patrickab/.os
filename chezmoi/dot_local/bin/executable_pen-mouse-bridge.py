#!/usr/bin/env python3
import os
import socket
import threading
import time

import evdev
from evdev import UInput, ecodes

SOURCE_NAME_SUBSTR = "IPTSD Virtual Stylus"

# Window classes to skip forwarding for, because they already handle the pen
# natively via the Wayland tablet protocol and would otherwise get duplicate
# input from this bridge's synthetic mouse. Find a class with:
#   hyprctl activewindow -j | jq -r .class
# and add it here if that app misbehaves with the pen (e.g. stray clicks,
# cursor jumps, broken drag) while this bridge is running.
IGNORED_WINDOW_CLASSES = {"google-chrome", "Vivaldi-flatpak"}

_current_class = None


def _watch_active_window():
    global _current_class
    sig = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    if not sig:
        return
    sock_path = f"{runtime_dir}/hypr/{sig}/.socket2.sock"
    while True:
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                sock.connect(sock_path)
                buf = b""
                while True:
                    buf += sock.recv(4096)
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.decode(errors="ignore")
                        if line.startswith("activewindow>>"):
                            _current_class = line.split(">>", 1)[1].split(",", 1)[0]
        except OSError:
            time.sleep(2)


def find_source():
    for path in evdev.list_devices():
        dev = evdev.InputDevice(path)
        if SOURCE_NAME_SUBSTR in dev.name:
            return dev
    return None


def build_uinput(source):
    abs_caps = dict(source.capabilities(absinfo=True)[ecodes.EV_ABS])
    events = {
        ecodes.EV_KEY: [ecodes.BTN_LEFT],
        ecodes.EV_ABS: [
            (ecodes.ABS_X, abs_caps[ecodes.ABS_X]),
            (ecodes.ABS_Y, abs_caps[ecodes.ABS_Y]),
        ],
    }
    return UInput(events, name="Pen Mouse Bridge", input_props=[ecodes.INPUT_PROP_POINTER])


def run():
    threading.Thread(target=_watch_active_window, daemon=True).start()

    while True:
        source = find_source()
        if source is None:
            time.sleep(2)
            continue

        ui = build_uinput(source)
        try:
            for event in source.read_loop():
                if _current_class in IGNORED_WINDOW_CLASSES:
                    continue
                if event.type == ecodes.EV_ABS and event.code in (ecodes.ABS_X, ecodes.ABS_Y):
                    ui.write(ecodes.EV_ABS, event.code, event.value)
                elif event.type == ecodes.EV_KEY and event.code == ecodes.BTN_TOUCH:
                    ui.write(ecodes.EV_KEY, ecodes.BTN_LEFT, event.value)
                elif event.type == ecodes.EV_SYN:
                    ui.syn()
        except OSError:
            pass
        finally:
            ui.close()
        time.sleep(1)


if __name__ == "__main__":
    run()
