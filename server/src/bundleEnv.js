import path from "node:path";
import { fileURLToPath } from "node:url";

// In the bundle, data and the built UI live next to mocker.js rather than in the source tree.
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.MOCKER_DATA_DIR ||= path.join(here, "data");
process.env.MOCKER_UI_DIR ||= path.join(here, "ui");
