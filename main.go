package main

import (
	"context"
	"embed"
	goruntime "runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"editor/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	a := app.New()

	// On macOS, copy and paste only work in the window with an Edit menu.
	var appMenu *menu.Menu
	if goruntime.GOOS == "darwin" {
		appMenu = menu.NewMenu()
		appMenu.Append(menu.AppMenu())
		appMenu.Append(menu.EditMenu())
	}

	err := wails.Run(&options.App{
		Title:            "Editor",
		Width:            1400,
		Height:           900,
		MinWidth:         640,
		MinHeight:        400,
		Menu:             appMenu,
		AssetServer:      &assetserver.Options{Assets: assets},
		BackgroundColour: &options.RGBA{R: 40, G: 44, B: 52, A: 255},
		OnStartup: func(ctx context.Context) {
			a.Emit = func(event string, data any) { wailsruntime.EventsEmit(ctx, event, data) }
			a.QuitFn = func() { wailsruntime.Quit(ctx) }
		},
		OnBeforeClose: func(ctx context.Context) bool { return a.BeforeClose() },
		OnShutdown:    func(ctx context.Context) { a.Shutdown() },
		Bind:          []interface{}{a},
		Mac: &mac.Options{
			TitleBar: mac.TitleBarDefault(),
		},
		Windows: &windows.Options{
			Theme: windows.Dark,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
