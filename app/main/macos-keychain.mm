// Run Security.framework on a worker so the main window remains usable while macOS asks for access.
#include <node_api.h>
#include <Security/Security.h>
#include <memory>
#include <string>
#include <string_view>

namespace {
constexpr char service[] = "com.expldfsh.sesshuttle.r2";

struct Request {
  std::string action, account, value;
  napi_deferred deferred{};
  napi_async_work work{};
  OSStatus status = errSecSuccess;
};

bool readString(napi_env env, napi_value input, std::string& out) {
  size_t length;
  if (napi_get_value_string_utf8(env, input, nullptr, 0, &length) != napi_ok || length > 65536) return false;
  out.resize(length + 1);
  if (napi_get_value_string_utf8(env, input, out.data(), out.size(), &length) != napi_ok) return false;
  out.resize(length);
  return true;
}

void perform(napi_env, void* context) {
  auto& r = *static_cast<Request*>(context);
  SecKeychainRef keychain = nullptr;
  r.status = SecKeychainCopyDefault(&keychain);
  if (r.status != errSecSuccess) return;
  SecKeychainStatus flags = 0;
  r.status = SecKeychainGetStatus(keychain, &flags);
  if (r.status == errSecSuccess && !(flags & kSecUnlockStateStatus))
    r.status = SecKeychainUnlock(keychain, 0, nullptr, false);
  if (r.status == errSecSuccess && r.action != "unlock") {
    SecKeychainItemRef item = nullptr;
    UInt32 length = 0;
    void* bytes = nullptr;
    const bool removing = r.action == "delete";
    const bool reading = r.action == "read" || removing;
    r.status = SecKeychainFindGenericPassword(keychain, sizeof(service) - 1, service,
      static_cast<UInt32>(r.account.size()), r.account.data(), reading ? &length : nullptr,
      reading ? &bytes : nullptr, &item);
    if (removing && r.status == errSecSuccess) {
      if (bytes && std::string_view(static_cast<const char*>(bytes), length) == r.value)
        r.status = SecKeychainItemDelete(item);
      else r.status = errSecDuplicateItem;
    } else if (reading && r.status == errSecSuccess && bytes) {
      r.value.assign(static_cast<const char*>(bytes), length);
    } else if (!reading) {
      const auto size = static_cast<UInt32>(r.value.size());
      if (r.status == errSecItemNotFound)
        r.status = SecKeychainAddGenericPassword(keychain, sizeof(service) - 1, service,
          static_cast<UInt32>(r.account.size()), r.account.data(), size, r.value.data(), nullptr);
      else if (r.status == errSecSuccess)
        r.status = SecKeychainItemModifyAttributesAndData(item, nullptr, size, r.value.data());
    }
    if (bytes) SecKeychainItemFreeContent(nullptr, bytes);
    if (item) CFRelease(item);
  }
  CFRelease(keychain);
}

void finish(napi_env env, napi_status jobStatus, void* context) {
  std::unique_ptr<Request> r(static_cast<Request*>(context));
  napi_value result;
  if (jobStatus == napi_ok && r->status == errSecSuccess) {
    if (r->action == "read") napi_create_string_utf8(env, r->value.data(), r->value.size(), &result);
    else napi_get_undefined(env, &result);
    napi_resolve_deferred(env, r->deferred, result);
  } else {
    const char* code = "credential_authorization_failed";
    if (r->status == errSecDuplicateItem) code = "credential_changed";
    if (r->status == errSecUserCanceled) code = "credential_cancelled";
    if (r->status == errSecItemNotFound) code = "credential_item_missing";
    if (r->status == errSecNoDefaultKeychain || r->status == errSecNotAvailable) code = "credential_service_unavailable";
    if (r->status == errSecDiskFull || r->status == errSecWrPerm) code = "credential_write_failed";
    napi_value message;
    napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, message, message, &result);
    napi_reject_deferred(env, r->deferred, result);
  }
  volatile char* bytes = r->value.data();
  for (size_t i = 0; i < r->value.size(); ++i) bytes[i] = 0;
  napi_delete_async_work(env, r->work);
}

napi_value request(napi_env env, napi_callback_info info) {
  std::unique_ptr<Request> r(new Request());
  size_t argc = 3;
  napi_value args[3], promise, label;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 3 || !readString(env, args[0], r->action) || !readString(env, args[1], r->account)
      || !readString(env, args[2], r->value) || r->account.empty() || r->account.size() > 128
      || (r->action != "read" && r->action != "write" && r->action != "unlock" && r->action != "delete")) {
    napi_throw_type_error(env, nullptr, "Invalid Keychain request");
    return nullptr;
  }
  napi_create_string_utf8(env, "SesshuttleKeychain", NAPI_AUTO_LENGTH, &label);
  if (napi_create_promise(env, &r->deferred, &promise) != napi_ok ||
      napi_create_async_work(env, nullptr, label, perform, finish, r.get(), &r->work) != napi_ok ||
      napi_queue_async_work(env, r->work) != napi_ok) {
    if (r->work) napi_delete_async_work(env, r->work);
    napi_throw_error(env, nullptr, "Cannot start Keychain request");
    return nullptr;
  }
  r.release();
  return promise;
}
// A per-login Mach port prevents two profiles with the same installation ID
// running concurrently, without a cross-profile lock file.
napi_value reserveInstance(napi_env env, napi_callback_info info) {
  napi_value argument, result;
  size_t count = 1;
  std::string name;
  napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr);
  if (!count || !readString(env, argument, name)) return nullptr;
  CFStringRef label = CFStringCreateWithCString(nullptr, name.c_str(), kCFStringEncodingUTF8);
  CFMessagePortRef port = CFMessagePortCreateLocal(nullptr, label, nullptr, nullptr, nullptr);
  CFRelease(label);
  if (port) napi_add_env_cleanup_hook(env, [](void* p) {
    auto local = static_cast<CFMessagePortRef>(p);
    CFMessagePortInvalidate(local);
    CFRelease(local);
  }, port);
  napi_get_boolean(env, port != nullptr, &result);
  return result;
}
} // namespace

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "request", NAPI_AUTO_LENGTH, request, nullptr, &fn);
  napi_value reserve;
  napi_create_function(env, "reserveInstance", NAPI_AUTO_LENGTH, reserveInstance, nullptr, &reserve);
  napi_set_named_property(env, fn, "reserveInstance", reserve);
  return fn;
}
