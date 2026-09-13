import "reflect-metadata";

import { Controller } from "@nestjs/common";

import { AppControllerOrganization } from "./app.controller/organization.js";

@Controller()
export class AppController extends AppControllerOrganization {}
