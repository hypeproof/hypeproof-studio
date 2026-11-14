# Optional account notification adapter

Notifications are a wake-up to the existing own-account question/inbox read. They
never grant approval, answer a question or send a reflection. The app requires an
explicit notification setting and the system permission independently of UX
measurement consent. Application code does not write provider tokens into its preference, export or
telemetry records; the platform/SDK manages provider token storage. The installation UUID and account/session preference are
stored in protected, no-backup local storage. Account changes require a new
explicit choice. Logout disables local receipt and attempts own registration
revocation; the Service also checks active sessions before delivery.

## Configuration stays off until qualified

- iOS: the default `HPSPushConfigured` Info.plist setting is `NO`. A release
  operator must enable the App ID capability, qualify the matching provisioning
  profile and provider environment, then explicitly set `HPS_IOS_PUSH_ENABLED=true`
  in the existing `apple-native-preview` release environment. Unset/empty or
  `false` keeps the existing push-off archive settings; other values fail closed.
  `apple-upload.sh` checks the supplied profile's exact app/team, expiry and
  production APS entitlement before archiving. It copies only the tracked push
  entitlement template into its private temporary directory and supplies fixed
  `CODE_SIGN_ENTITLEMENTS`, `HPS_APNS_ENVIRONMENT=production` and
  `INFOPLIST_KEY_HPSPushConfigured=YES` settings. Before validation/upload it
  verifies the exported IPA signature, app/team/profile, production entitlement
  and actual Info.plist setting (Boolean true or literal `YES`, as the app reads).
  Unsafe/ambiguous/oversized IPA archives are refused before private extraction.
  `push-configuration.json` records sanitized configuration/package digests and
  the completed phase, separately from the unchanged release/upload receipt.
  No App ID, provider credential or entitlement is enabled by default. The actual APNs callback must succeed;
  there is no sample token or permission fallback.
- Android: `firebase-messaging:26.0.2` is pinned to the official current SDK. Supply
  the real Firebase Android project's standard generated resource XML for the
  exact application ID/variant with `-PhpsFirebaseResources=/absolute/res`.
  Resources include `google_app_id`, `gcm_defaultSenderId`, `project_id` and
  `google_api_key`; do not place service-account credentials in the app. The
  google-services Gradle plugin's output is the standard resource contract, so
  this optional source directory does not require an unconfigured project to
  pretend that a `google-services.json` exists. With no configuration the setting
  visibly says unavailable. FCM auto-init, Analytics and notification delegation
  are off. The existing Service v1 protocol accepts registration tokens, so the
  still-supported `getToken`/`onNewToken` path is used with FID mode explicitly off.
  Android 13+ asks for the OS permission only on the person's explicit action.

Opening a notification requires a matching current-account `/opened` receipt and
then reloads the existing question/inbox surface. An old reference, old account,
missing configuration or rejected registration does not enable an action. These
client observations are not physical-delivery evidence.

Primary references: [Apple registration](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns),
[Firebase Android setup](https://firebase.google.com/docs/android/setup),
[FCM token API](https://firebase.google.com/docs/reference/android/com/google/firebase/messaging/FirebaseMessaging),
[FCM service and permission](https://firebase.google.com/docs/cloud-messaging/android/get-started),
[SDK versions](https://firebase.google.com/support/release-notes/android).

Actual APNs/FCM delivery, signed entitlement/profile, configured project and physical
open are **NOT RUN**. No provider key, entitlement, live flag or enrollment is
created by this adapter. Declining notifications leaves conversation/cards/inbox
usable. A successful local HTTP transport control is not provider acceptance.

Portable release-wiring regression: `python3 -m unittest discover -s
apps/studio-native/tests -p 'test_apple_push_config.py' -v`. Its controlled
Apple tools exercise the real upload script's archive-to-upload ordering and
failure fences; they do not establish Apple signing or device delivery. The
additional local validation makes no provider call or new CI dispatch. Existing
release request identity, environment protection, package hashing and receipt
authority remain unchanged.
