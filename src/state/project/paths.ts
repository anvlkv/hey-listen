/** The project file extension (mirrors the Rust `PROJECT_EXTENSION`). */
export const PROJECT_EXTENSION = "heyl";

/** A path's last segment (`/` or `\` separated), falling back to the whole path. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** A file path's base name without its extension — used as the project title. */
export function projectLabel(path: string): string {
  const name = basename(path);
  return name.replace(/\.[^.]+$/, "") || name;
}

/** True when `path` names a Hey Listen project file (`.heyl`). */
export function isProjectFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === PROJECT_EXTENSION;
}
