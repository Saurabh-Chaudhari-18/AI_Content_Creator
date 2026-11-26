import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The backend's Python: E2E_PYTHON (CI), else backend/.venv. */
export const PYTHON =
  process.env.E2E_PYTHON ??
  path.resolve(E2E_DIR, "../../backend/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** The test-only staff login that e2e/start_api.py creates (e2e database only). */
export const STAFF = {
  email: process.env.E2E_STAFF_EMAIL ?? "e2e-staff@example.com",
  password: process.env.E2E_STAFF_PASSWORD ?? "e2e-staff-password-1",
};
