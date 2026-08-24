import type { RuleSetRule } from "webpack";

export const rules: RuleSetRule[] = [
  {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    use: [{ loader: "ts-loader", options: { transpileOnly: true } }]
  },
  {
    test: /\.css$/,
    use: ["style-loader", "css-loader"]
  }
];
