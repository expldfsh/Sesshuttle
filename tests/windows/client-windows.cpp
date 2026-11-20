// Read-only acceptance check for the two installed client windows.
#include <windows.h>
#include <algorithm>
#include <cwctype>
#include <iostream>
#include <string>

struct Clients {
    std::wstring desktop, editor;
};

static BOOL CALLBACK inspect(HWND window, LPARAM state) {
    if (!IsWindowVisible(window) || !GetWindowTextLengthW(window)) return TRUE;
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (!process) return TRUE;
    wchar_t buffer[32768];
    DWORD size = sizeof(buffer) / sizeof(buffer[0]);
    const BOOL read = QueryFullProcessImageNameW(process, 0, buffer, &size);
    CloseHandle(process);
    if (!read) return TRUE;
    std::wstring file(buffer, size), lower(file);
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](wchar_t c) { return std::towlower(c); });
    const auto name = lower.substr(lower.find_last_of(L'\\') + 1);
    auto& clients = *reinterpret_cast<Clients*>(state);
    if (name == L"chatgpt.exe" && lower.find(L"\\windowsapps\\openai.codex_") != std::wstring::npos)
        clients.desktop = file;
    if (name == L"code.exe" && lower.find(L"\\microsoft vs code\\") != std::wstring::npos)
        clients.editor = file;
    return TRUE;
}

int main() {
    Clients clients;
    const ULONGLONG deadline = GetTickCount64() + 300000;
    do {
        EnumWindows(inspect, reinterpret_cast<LPARAM>(&clients));
        if (!clients.desktop.empty() && !clients.editor.empty()) {
            std::wcout << clients.desktop << L'\n' << clients.editor << L'\n';
            return 0;
        }
        Sleep(1000);
    } while (GetTickCount64() < deadline);
    std::wcerr << L"Desktop: " << clients.desktop << L"\nEditor: " << clients.editor << L'\n';
    return 1;
}
