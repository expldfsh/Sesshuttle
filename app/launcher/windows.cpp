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

static int start(const std::wstring& exe, std::wstring command, const wchar_t* cwd,
                 bool terminal) {
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(exe.c_str(), command.data(), nullptr, nullptr, !terminal,
                        terminal ? CREATE_NEW_CONSOLE : 0, nullptr, cwd, &startup, &process))
        return 2;
    CloseHandle(process.hThread);
    DWORD result = 0;
    if (!terminal) {
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, &result);
    }
    CloseHandle(process.hProcess);
    return static_cast<int>(result);
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
    if (count == 6 && args[1] == L"--resume-cli") {
        if (!SetEnvironmentVariableW(L"CODEX_HOME", args[3].c_str())) return 2;
        return start(args[2], quoted(args[2]) + L" --cd " + quoted(args[4]) + L" resume " +
                     quoted(args[5]), args[4].c_str(), true);
    }
    std::vector<wchar_t> file(32768);
    DWORD length = GetModuleFileNameW(nullptr, file.data(), static_cast<DWORD>(file.size()));
    if (!length || length >= file.size()) return 2;
    std::wstring dir(file.data(), length);
    dir.resize(dir.rfind(L'\\') + 1);
    std::wstring exe = dir + L"sesshuttle-runtime.exe";
    std::wstring script = dir + L"resources\\sesshuttle-start.cjs";
    SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", L"1");
    if (!GetEnvironmentVariableW(L"LANG", nullptr, 0))
        SetEnvironmentVariableW(L"LANG", PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_CHINESE
                                            ? L"zh-CN" : L"en");
    return start(exe, quoted(exe) + L" " + quoted(script) + L" " + tail, nullptr, false);
}
