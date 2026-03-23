import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pricesRouter from "./prices";
import opportunitiesRouter from "./opportunities";
import analyticsRouter from "./analytics";
import scanRouter from "./scan";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pricesRouter);
router.use(opportunitiesRouter);
router.use(analyticsRouter);
router.use(scanRouter);

export default router;
