/** @jsxImportSource @solidjs/web */
import { render } from "@solidjs/web";
import App from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Workflow demo root element was not found");

render(() => <App />, root);
