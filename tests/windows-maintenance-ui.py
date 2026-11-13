"""Drive only the NSIS wizard spawned by this test, on a disposable Windows desktop."""
import ctypes as c
from ctypes import wintypes as w
import subprocess
import sys
import time

user = c.WinDLL("user32", use_last_error=True)
kernel = c.WinDLL("kernel32", use_last_error=True)
callback = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)


class ProcessEntry(c.Structure):
    _fields_ = [
        ("dwSize", w.DWORD), ("cntUsage", w.DWORD), ("pid", w.DWORD),
        ("heap", c.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
        ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
        ("exe", w.WCHAR * 260),
    ]


kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
kernel.Process32FirstW.argtypes = kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(ProcessEntry)]
kernel.CloseHandle.argtypes = [w.HANDLE]
user.EnumWindows.argtypes = [callback, w.LPARAM]
user.EnumChildWindows.argtypes = [w.HWND, callback, w.LPARAM]
user.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
user.IsWindowVisible.argtypes = user.IsWindowEnabled.argtypes = [w.HWND]
user.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
user.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
user.SendMessageTimeoutW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM, w.UINT, w.UINT, c.POINTER(c.c_size_t)]


def process_tree(known):
    handle = kernel.CreateToolhelp32Snapshot(2, 0)
    if handle == w.HANDLE(-1).value:
        raise c.WinError(c.get_last_error())
    entry = ProcessEntry()
    entry.dwSize = c.sizeof(entry)
    parents = {}
    try:
        more = kernel.Process32FirstW(handle, c.byref(entry))
        while more:
            parents[entry.pid] = entry.parent
            more = kernel.Process32NextW(handle, c.byref(entry))
    finally:
        kernel.CloseHandle(handle)
    while True:
        children = {pid for pid, parent in parents.items() if parent in known}
        if children <= known:
            return known & parents.keys()
        known.update(children)


def windows(parent=None):
    result = []

    @callback
    def collect(hwnd, _unused):
        if user.IsWindowVisible(hwnd):
            result.append(hwnd)
        return True

    if parent is None:
        user.EnumWindows(collect, 0)
    else:
        user.EnumChildWindows(parent, collect, 0)
    return result


def native_class(hwnd):
    name = c.create_unicode_buffer(128)
    user.GetClassNameW(hwnd, name, len(name))
    return name.value.casefold()


def message(hwnd, kind, first=0, second=0):
    value = c.c_size_t()
    user.SendMessageTimeoutW(hwnd, kind, first, second, 2, 500, c.byref(value))
    return value.value


def buttons(pids):
    result = {}
    for window in windows():
        pid = w.DWORD()
        user.GetWindowThreadProcessId(window, c.byref(pid))
        if pid.value not in pids or native_class(window) != "#32770" or not user.IsWindowEnabled(window):
            continue
        for control in windows(window):
            if native_class(control) != "button" or not user.IsWindowEnabled(control):
                continue
            text = c.create_unicode_buffer(256)
            message(control, 0x000D, len(text), c.addressof(text))  # WM_GETTEXT
            label = text.value.replace("&", "").strip(" <>").casefold()
            if label:
                result[label] = control
    return result


def click(hwnd):
    if not user.PostMessageW(hwnd, 0x00F5, 0, 0):  # BM_CLICK
        raise c.WinError(c.get_last_error())
    time.sleep(0.25)


def run(exe, action):
    if action not in {"cancel", "repair"}:
        raise ValueError(action)
    launcher = subprocess.Popen([exe])
    known = {launcher.pid}
    selected = False
    observed = set()
    deadline = time.monotonic() + 210
    while time.monotonic() < deadline:
        live = process_tree(known)
        controls = buttons(live)
        observed.update(controls)
        if selected and not live:
            print(f"PASS Windows maintenance dialog: {action}.")
            return
        repair = next((h for key, h in controls.items() if key.startswith(("восстановить ", "repair "))), None)
        remove = next((h for key, h in controls.items() if key.startswith(("удалить ", "remove ", "uninstall "))), None)
        if not selected and repair and remove:
            if message(repair, 0x00F0) != 1 or message(remove, 0x00F0) != 0:  # BM_GETCHECK
                raise RuntimeError("Repair must be the default maintenance choice.")
            if action == "cancel":
                cancel = controls.get("отмена") or controls.get("cancel")
                if not cancel:
                    raise RuntimeError("The maintenance choice cannot be cancelled.")
                click(cancel)
            else:
                click(repair)
            selected = True
        elif selected:
            launch = controls.get("запустить craftcode link") or controls.get("start craftcode link")
            if launch and message(launch, 0x00F0) == 1:
                click(launch)
            labels = ("да", "yes") if action == "cancel" else (
                "восстановить", "repair", "далее", "next", "готово", "finish", "закрыть", "close",
            )
            target = next((controls[label] for label in labels if label in controls), None)
            if target:
                click(target)
        time.sleep(0.2)
    raise RuntimeError(f"Maintenance {action} did not finish. Visible controls: {sorted(observed)}")


if __name__ == "__main__":
    run(*sys.argv[1:])
