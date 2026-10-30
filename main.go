package main

import (
	"embed"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"editor/internal/app"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	a := app.New()

	wails := application.New(application.Options{
		Name:        "Editor",
		Description: "Edits files in an OpenShift or Dev Spaces container",
		Services:    []application.Service{application.NewService(a)},
		Assets:      application.AssetOptions{Handler: application.AssetFileServerFS(assets)},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		// Cmd+Q (and quitting from the Dock) asks first when there are unsaved changes.
		ShouldQuit: func() bool { return !a.BeforeClose() },
	})

	// On macOS, copy and paste only work in a window with an Edit menu. The app menu's Hide
	// shortcut is dropped: Cmd+H is the editor's "previous tab".
	if runtime.GOOS == "darwin" {
		menu := application.NewMenu()
		appMenu := menu.AddSubmenu("Editor")
		appMenu.AddRole(application.About)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Hide)
		appMenu.FindByRole(application.Hide).RemoveAccelerator()
		appMenu.AddRole(application.HideOthers)
		appMenu.AddRole(application.UnHide)
		appMenu.AddSeparator()
		appMenu.AddRole(application.Quit)
		menu.AddRole(application.EditMenu)
		wails.Menu.SetApplicationMenu(menu)
	}

	win := wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Editor",
		Width:            1400,
		Height:           900,
		MinWidth:         640,
		MinHeight:        400,
		BackgroundColour: application.NewRGB(40, 44, 52),
		URL:              "/",
		Windows:          application.WindowsWindow{Theme: application.Dark},
	})
	// Closing the window with unsaved changes asks the page first; it calls Quit if the
	// user says to discard them.
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if a.BeforeClose() {
			e.Cancel()
		}
	})

	a.Emit = func(event string, data any) { wails.Event.Emit(event, data) }
	a.PickFolderFn = func() (string, error) {
		return wails.Dialog.OpenFile().
			SetTitle("Open folder").
			SetButtonText("Open").
			CanChooseDirectories(true).
			CanChooseFiles(false).
			CanCreateDirectories(true).
			AttachToWindow(win).
			PromptForSingleSelection()
	}
	a.QuitFn = wails.Quit

	if err := wails.Run(); err != nil {
		log.Fatal(err)
	}
}
