//! Keeping the process responsive while it is in the background (macOS).
//!
//! MCP clients drive the app from another window, and live capture keeps running when
//! the user switches away — but macOS **App Nap** throttles a background app: it
//! coalesces timers, lowers CPU and I/O priority, and can suspend the process outright.
//! That is the wrong trade for a workbench that has to answer a socket or record audio
//! while the user is elsewhere, so the app declares a **user-initiated activity** for
//! its lifetime.
//!
//! Two layers say the same thing, on purpose: the bundle's `Info.plist` sets
//! `NSAppSleepDisabled` (declarative, and in effect from launch), and this module
//! asserts it at runtime — which also covers the ways the binary can run without a
//! bundle (a dev build, a bare executable, the E2E harness).
//!
//! `UserInitiatedAllowingIdleSystemSleep` opts out of App Nap but still lets the
//! machine sleep, so it does not keep a Mac awake.

/// Declare the app user-initiated so macOS does not App Nap it. Call once, at startup.
pub fn prevent() {
    // Leaked on purpose: an activity lasts until its token is released, and this one
    // should last for the whole process.
    let _ = Box::leak(Box::new(Activity::begin()));
}

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::ProtocolObject;
#[cfg(target_os = "macos")]
use objc2_foundation::NSObjectProtocol;

/// The activity token: releasing it would re-enable App Nap, so it is held for the
/// process lifetime (see [`prevent`]). The field is never read — keeping it alive is the
/// whole point.
#[cfg(target_os = "macos")]
struct Activity(#[allow(dead_code)] Retained<ProtocolObject<dyn NSObjectProtocol>>);

#[cfg(target_os = "macos")]
impl Activity {
    fn begin() -> Self {
        use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

        let reason = NSString::from_str(
            "Hey Listen serves MCP requests and records audio while in the background.",
        );
        let token = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &reason,
        );
        log::info!("App Nap disabled for this process (user-initiated activity)");
        Self(token)
    }
}

/// Other platforms have no App Nap; the call site stays the same.
#[cfg(not(target_os = "macos"))]
struct Activity;

#[cfg(not(target_os = "macos"))]
impl Activity {
    fn begin() -> Self {
        Self
    }
}
