import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as checklistController from "./checklist.controller.js";

export const checklistRouter = Router();

checklistRouter.use(requireAuth);

checklistRouter.get("/", checklistController.list);
checklistRouter.post("/", checklistController.create);

// Item routes before :checklistId to avoid collisions
checklistRouter.patch("/items/:itemId", checklistController.updateItem);
checklistRouter.patch(
  "/items/:itemId/complete",
  checklistController.completeItem,
);
checklistRouter.delete("/items/:itemId", checklistController.removeItem);

checklistRouter.patch("/:checklistId", checklistController.update);
checklistRouter.delete("/:checklistId", checklistController.remove);
checklistRouter.post("/:checklistId/items", checklistController.createItem);
checklistRouter.patch(
  "/:checklistId/reorder",
  checklistController.reorderItems,
);
checklistRouter.get("/:checklistId/progress", checklistController.progress);
