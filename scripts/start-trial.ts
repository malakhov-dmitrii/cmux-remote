// Compatibility entry for earlier local launch commands.
import { main } from "./serve";

if (import.meta.main) await main();
