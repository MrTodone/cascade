/**
 * Entry point for the compiled single-executable (cascade.exe).
 * No vite/dev dependencies reach this graph — only production static serving.
 */
import { start } from "../server";

void start();