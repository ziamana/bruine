"use client";

import { useRef, useState } from "react";
import { asset } from "@/lib/i18n";

/** The film in the same window as the session: a poster and one play mark, the controls once it runs. */
export function Film({ title, play }: { title: string; play: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const start = (): void => {
    setStarted(true);
    void videoRef.current?.play();
  };
  return (
    <figure className="window film-window">
      <figcaption className="window-bar">
        <span className="window-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="window-title">{title}</span>
        <span className="window-stamp" aria-hidden="true">
          0:42
        </span>
      </figcaption>
      <div className="film-screen">
        <video ref={videoRef} controls={started} preload="none" playsInline poster={asset("/media/film-poster.jpg")} width="1280" height="720">
          <source src={asset("/media/bruine-film.mp4")} type="video/mp4" />
        </video>
        {started ? null : (
          <button type="button" className="film-play" onClick={start}>
            <span className="film-play-mark" aria-hidden="true">
              <svg width="22" height="24" viewBox="0 0 22 24" fill="currentColor">
                <path d="M2 2.6v18.8c0 1.2 1.3 1.9 2.3 1.3l15.4-9.4c1-.6 1-2 0-2.6L4.3 1.3C3.3.7 2 1.4 2 2.6z" />
              </svg>
            </span>
            <span>{play}</span>
          </button>
        )}
      </div>
    </figure>
  );
}
