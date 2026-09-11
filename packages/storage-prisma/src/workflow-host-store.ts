import { PrismaWorkflowHostRunLifecycleStore } from "./workflow-host-store/run-lifecycle-store.js";

import type { WorkflowHostStore } from "@cosmos/application";

export class PrismaWorkflowHostStore extends PrismaWorkflowHostRunLifecycleStore implements WorkflowHostStore {}
