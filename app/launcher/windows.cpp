// GUI entry point. Folder selection runs before Electron can create a default profile.
#include <windows.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <cstdio>
#include <string>
#include <vector>

static std::wstring quoted(const std::wstring& value) {
    // CreateProcess passes a single string to the child's Windows argument parser.
    std::wstring text = L"\"";
    size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') { ++slashes; continue; }
        text.append(c == L'"' ? 2 * slashes + 1 : slashes, L'\\');
        text += c;
        slashes = 0;
    }
    text.append(2 * slashes, L'\\');
    return text + L"\"";
}

// False when the program could not be started; `result` then holds the system error.
// Otherwise it holds the exit code of a program that was waited for.
static bool start(const std::wstring& exe, std::wstring command, const wchar_t* cwd,
                  bool terminal, DWORD* result) {
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, !terminal,
                        terminal ? CREATE_NEW_CONSOLE : 0, nullptr, cwd, &startup, &process)) {
        *result = GetLastError();
        return false;
    }
    CloseHandle(process.hThread);
    *result = 0;
    if (!terminal) {
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, result);
    }
    CloseHandle(process.hProcess);
    return true;
}

static bool chinese() {
    return PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_CHINESE;
}

// The app cannot explain this itself: it is the app that did not start.
static int startFailed(const std::wstring& file, DWORD error) {
    std::wstring text = chinese()
        ? L"无法启动 Sesshuttle。\n\n请把下载的 ZIP 完整解压到一个文件夹，再打开其中的 "
          L"Sesshuttle.exe。如果安全软件移走了下面的文件，请先恢复它。\n\n"
        : L"Sesshuttle could not start.\n\nExtract the whole ZIP into one folder, then open "
          L"Sesshuttle.exe from it. If security software removed the file below, restore it "
          L"first.\n\n";
    text += file;
    wchar_t reason[512];
    DWORD length = FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                                  nullptr, error, 0, reason, 512, nullptr);
    if (length) text += L"\n\n" + std::wstring(reason, length);
    MessageBoxW(nullptr, text.c_str(), L"Sesshuttle", MB_OK | MB_ICONERROR | MB_SETFOREGROUND);
    return 2;
}

static std::wstring systemProgram(const wchar_t* name) {
    wchar_t directory[MAX_PATH];
    UINT length = GetSystemDirectoryW(directory, MAX_PATH);
    if (!length || length >= MAX_PATH) return L"";
    return std::wstring(directory, length) + L"\\" + name;
}

static bool output(const wchar_t* value) {
    int size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) return false;
    std::vector<char> bytes(size);
    WideCharToMultiByte(CP_UTF8, 0, value, -1, bytes.data(), size, nullptr, nullptr);
    DWORD written = 0;
    return WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), bytes.data(), size - 1, &written, nullptr)
        && written == static_cast<DWORD>(size - 1);
}

static int choose(const wchar_t* title, const wchar_t* home) {
    if (FAILED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED))) return 2;
    IFileOpenDialog* dialog = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                  IID_PPV_ARGS(&dialog));
    if (SUCCEEDED(hr)) {
        DWORD options = 0;
        hr = dialog->GetOptions(&options);
        if (SUCCEEDED(hr)) hr = dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
                                                   | FOS_PATHMUSTEXIST | FOS_DONTADDTORECENT);
        IShellItem* initial = nullptr;
        if (SUCCEEDED(SHCreateItemFromParsingName(home, nullptr, IID_PPV_ARGS(&initial)))) {
            dialog->SetDefaultFolder(initial);
            initial->Release();
        }
        if (SUCCEEDED(hr)) hr = dialog->SetTitle(title);
        if (SUCCEEDED(hr)) hr = dialog->Show(nullptr);
        IShellItem* item = nullptr;
        if (SUCCEEDED(hr)) hr = dialog->GetResult(&item);
        if (item) {
            PWSTR name = nullptr;
            hr = item->GetDisplayName(SIGDN_FILESYSPATH, &name);
            if (SUCCEEDED(hr) && !output(name)) hr = E_FAIL;
            CoTaskMemFree(name);
            item->Release();
        }
        dialog->Release();
    }
    CoUninitialize();
    return hr == HRESULT_FROM_WIN32(ERROR_CANCELLED) ? 1 : FAILED(hr) ? 2 : 0;
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR tail, int) {
    int count = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &count);
    if (!argv) return 2;
    std::vector<std::wstring> args(argv, argv + count);
    LocalFree(argv);
    if (count == 5 && args[1] == L"--folder-dialog") {
        if (args[2] == L"choose") return choose(args[3].c_str(), args[4].c_str());
        bool confirm = args[2] == L"confirm";
        int picked = MessageBoxW(nullptr, args[3].c_str(), L"Sesshuttle",
                                 MB_SETFOREGROUND | (confirm ? MB_OKCANCEL | MB_ICONQUESTION
                                                            : MB_OK | MB_ICONERROR));
        return picked == IDOK ? 0 : picked == IDCANCEL ? 1 : 2;
    }
    DWORD code = 0;
    if (count == 6 && args[1] == L"--resume-cli") {
        if (!SetEnvironmentVariableW(L"CODEX_HOME", args[3].c_str())) return 2;
        // The language handed to the app is no setting of Codex.
        SetEnvironmentVariableW(L"SESSHUTTLE_LANG", nullptr);
        std::wstring codex = quoted(args[2]) + L" --cd " + quoted(args[4]) + L" resume " +
                             quoted(args[5]);
        // Started by the command interpreter, a failure stays on screen until a key is
        // pressed instead of closing with its window. The interpreter expands %NAME%
        // even inside quotes, so a command with a percent sign starts Codex directly.
        std::wstring shell = systemProgram(L"cmd.exe");
        if (!shell.empty() && codex.find(L'%') == std::wstring::npos &&
            start(shell, quoted(shell) + L" /d /v:off /s /c \"" + codex + L" || pause\"",
                  args[4].c_str(), true, &code))
            return 0;
        return start(args[2], codex, args[4].c_str(), true, &code) ? 0 : 2;
    }
    std::vector<wchar_t> file(32768);
    DWORD length = GetModuleFileNameW(nullptr, file.data(), static_cast<DWORD>(file.size()));
    if (!length || length >= file.size()) return 2;
    std::wstring dir(file.data(), length);
    dir.resize(dir.rfind(L'\\') + 1);
    std::wstring exe = dir + L"sesshuttle-runtime.exe";
    std::wstring script = dir + L"resources\\sesshuttle-start.cjs";
    // An incomplete extraction or a quarantined file would otherwise end without a word.
    // Any other doubt about a file is left to the start itself.
    for (const std::wstring* part : {&exe, &script}) {
        if (GetFileAttributesW(part->c_str()) != INVALID_FILE_ATTRIBUTES) continue;
        DWORD missing = GetLastError();
        if (missing == ERROR_FILE_NOT_FOUND || missing == ERROR_PATH_NOT_FOUND)
            return startFailed(*part, missing);
    }
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
    // The display language of Windows, for the questions asked before the window opens.
    if (!GetEnvironmentVariableW(L"SESSHUTTLE_LANG", nullptr, 0))
        SetEnvironmentVariableW(L"SESSHUTTLE_LANG", chinese() ? L"zh-CN" : L"en");
    // This program has no window of its own. The folder questions and the app window
    // belong to processes it starts, which may come to the front in its place.
    AllowSetForegroundWindow(ASFW_ANY);
    if (!start(exe, quoted(exe) + L" " + quoted(script) + L" " + tail, nullptr, false, &code))
        return startFailed(exe, code);
    return static_cast<int>(code);
}
