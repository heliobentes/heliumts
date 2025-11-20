import { startDevServer } from "../../heliumjs/dist/server";
import { createTask } from "./server/createTask";
import { getTasks } from "./server/getTasks";

startDevServer((registry) => {
  registry.register("getTasks", getTasks);
  registry.register("createTask", createTask);
});
