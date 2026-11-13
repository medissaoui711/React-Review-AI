import { bindings, defineConfig, defineContainer, exports } from "cf/config";
import * as entrypoint from "./cloudflare/worker.ts" with { type: "cf-worker" };

const reactReviewContainer = defineContainer({
  name: "react-review-ai-demo",
  image: { dockerfile: "./Dockerfile" },
  instanceType: "basic",
  maxInstances: 1,
});

export default defineConfig({
  worker: {
    name: "react-review-ai-demo",
    entrypoint,
    compatibilityDate: "2026-11-13",
    exports: {
      ReactReviewContainer: exports.durableObject({
        storage: "sqlite",
        container: reactReviewContainer,
      }),
    },
    env: {
      REACT_REVIEW_CONTAINER: bindings.durableObject({
        worker: "react-review-ai-demo",
        exportName: "ReactReviewContainer",
      }),
    },
  },
  containers: [reactReviewContainer],
});
