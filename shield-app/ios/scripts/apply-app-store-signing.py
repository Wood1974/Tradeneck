#!/usr/bin/env python3
"""Put manual App Store signing on the App target's Release config only.

xcodebuild command-line CODE_SIGN_STYLE / PROVISIONING_PROFILE_SPECIFIER
overrides apply to every target, including CocoaPods frameworks, and export
then fails with "does not support provisioning profiles". This edits the App
target Release block in project.pbxproj and leaves Debug and the project-level
configs alone.
"""
import argparse
import sys
from pathlib import Path


def app_release_id(text: str) -> str:
    # The target also mentions this list in a comment. Use the object definition.
    marker = '/* Build configuration list for PBXNativeTarget "App" */ = {'
    start = text.find(marker)
    if start < 0:
        raise SystemExit("App target build configuration list was not found")
    window = text[start:start + 600]
    token = "/* Release */"
    rel = window.find(token)
    if rel < 0:
        raise SystemExit("App target Release configuration id was not found")
    line_start = window.rfind("\n", 0, rel) + 1
    config_id = window[line_start:rel].strip().split()[0]
    if len(config_id) != 24:
        raise SystemExit(f"unexpected App Release config id {config_id!r}")
    return config_id


def configuration_span(text: str, config_id: str) -> tuple[int, int]:
    header = f"\t\t{config_id} /* Release */ = {{"
    start = text.find(header)
    if start < 0:
        raise SystemExit(f"configuration block {config_id} was not found")
    end = text.find("\n\t\t};", start)
    if end < 0:
        raise SystemExit(f"configuration block {config_id} does not end")
    return start, end + len("\n\t\t};")


def build_settings_span(block: str) -> tuple[int, int]:
    key = "buildSettings = {"
    start = block.find(key)
    if start < 0:
        raise SystemExit("App Release configuration has no buildSettings")
    body_start = start + len(key)
    end = block.find("\n\t\t\t};", body_start)
    if end < 0:
        raise SystemExit("App Release buildSettings does not end")
    return body_start, end


def apply(text: str, profile_name: str, profile_uuid: str, identity: str) -> str:
    config_id = app_release_id(text)
    block_start, block_end = configuration_span(text, config_id)
    block = text[block_start:block_end]
    body_start, body_end = build_settings_span(block)
    body = block[body_start:body_end]
    for key in (
        "CODE_SIGN_IDENTITY",
        "CODE_SIGN_STYLE",
        "DEVELOPMENT_TEAM",
        "PROVISIONING_PROFILE",
        "PROVISIONING_PROFILE_SPECIFIER",
    ):
        lines = []
        for line in body.splitlines(keepends=True):
            stripped = line.lstrip("\t")
            if stripped.startswith(key + " ") or stripped.startswith(key + "="):
                continue
            lines.append(line)
        body = "".join(lines)
    quoted_identity = identity.replace("\\", "\\\\").replace('"', '\\"')
    quoted_name = profile_name.replace("\\", "\\\\").replace('"', '\\"')
    insertion = (
        f'\n\t\t\t\tCODE_SIGN_IDENTITY = "{quoted_identity}";'
        "\n\t\t\t\tCODE_SIGN_STYLE = Manual;"
        f'\n\t\t\t\tPROVISIONING_PROFILE = "{profile_uuid}";'
        f'\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = "{quoted_name}";'
    )
    new_block = block[:body_start] + insertion + body + block[body_end:]
    return text[:block_start] + new_block + text[block_end:]


def assert_scoped(text: str, profile_name: str, profile_uuid: str) -> None:
    config_id = app_release_id(text)
    block_start, block_end = configuration_span(text, config_id)
    block = text[block_start:block_end]
    quoted_name = f'"{profile_name}"'
    quoted_uuid = f'"{profile_uuid}"'
    if "CODE_SIGN_STYLE = Manual;" not in block:
        raise SystemExit("App Release is not manual signing")
    if f"PROVISIONING_PROFILE_SPECIFIER = {quoted_name};" not in block:
        raise SystemExit("App Release is missing the App Store profile name")
    if f"PROVISIONING_PROFILE = {quoted_uuid};" not in block:
        raise SystemExit("App Release is missing the App Store profile UUID")
    outside = text[:block_start] + text[block_end:]
    for needle in (
        "PROVISIONING_PROFILE_SPECIFIER",
        "PROVISIONING_PROFILE =",
        "CODE_SIGN_STYLE = Manual",
    ):
        if needle in outside:
            raise SystemExit(f"{needle} leaked outside the App Release configuration")
    if "CODE_SIGN_STYLE = Automatic;" not in text:
        raise SystemExit("App Debug lost automatic signing")
    print(f"manual signing is only on App Release ({config_id})")


def assert_pods_unsigned(pods_pbx: Path) -> None:
    text = pods_pbx.read_text()
    allowed = text.count("CODE_SIGNING_ALLOWED = NO;")
    required = text.count("CODE_SIGNING_REQUIRED = NO;")
    if allowed < 1 or required < 1:
        raise SystemExit("pod targets are missing CODE_SIGNING_ALLOWED/REQUIRED = NO")
    if allowed != required:
        raise SystemExit(
            f"pod signing flags disagree: CODE_SIGNING_ALLOWED={allowed} CODE_SIGNING_REQUIRED={required}"
        )
    if "PROVISIONING_PROFILE_SPECIFIER" in text or "PROVISIONING_PROFILE =" in text:
        raise SystemExit("a pod target still has a provisioning profile")
    print(f"pod targets do not use a provisioning profile ({allowed} configurations)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pbxproj")
    parser.add_argument("--profile-name", required=True)
    parser.add_argument("--profile-uuid", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--check", action="store_true", help="rewrite, then assert the profile is only on App Release")
    parser.add_argument("--check-pods")
    args = parser.parse_args()
    path = Path(args.pbxproj)
    updated = apply(path.read_text(), args.profile_name, args.profile_uuid, args.identity)
    if args.check:
        assert_scoped(updated, args.profile_name, args.profile_uuid)
    else:
        path.write_text(updated)
        assert_scoped(path.read_text(), args.profile_name, args.profile_uuid)
    if args.check_pods:
        assert_pods_unsigned(Path(args.check_pods))


if __name__ == "__main__":
    main()
