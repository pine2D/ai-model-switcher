import type { Configuration } from "webpack";

import { rules } from "./webpack.rules";

export const rendererConfig: Configuration = {
  devtool: "source-map",
  module: { rules },
  resolve: { extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"] }
};
