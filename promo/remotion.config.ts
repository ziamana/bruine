import { Config } from "@remotion/cli/config";

// YouTube master: H.264, high quality, standard chroma so every player shows the same colours.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(95);
Config.setCodec("h264");
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
Config.setAudioCodec("aac");
Config.setAudioBitrate("320k");
