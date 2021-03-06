import {
  CloseAction,
  createConnection,
  ErrorAction,
  IConnection,
  MonacoLanguageClient,
  MonacoServices,
  Range
} from "monaco-languageclient";
import * as normalizeUrl from "normalize-url";
import { ICodeNotification, NotificationEnum } from "ov-language-server-types";
import { listen, MessageConnection } from "vscode-ws-jsonrpc";
import { ContentEnum, ContentManager } from "../ContentManager";
import { createTokenizationSupport } from "../syntax-highlighting/TokensProvider";
import ReconnectingWebSocket from "reconnecting-websocket";

const PORT = process.env.PORT || 3010;

export class LspClientCreator {
  /**
   * Creates the language-client und connects it to the language-server
   *
   * @static
   * @param {monaco.editor.IStandaloneCodeEditor} ovlEditor the monaco-editor which
   *          needs to be connected to the language server
   * @param {monaco.editor.IStandaloneCodeEditor} schemaEditor the editor for the
   *          schema definition in ov
   * @param {monaco.editor.IStandaloneCodeEditor} outputEditor the editor which displays
   *          the generated source-code
   * @memberof LspClient
   */
  public static createLspClient(
    ovlEditor: monaco.editor.IStandaloneCodeEditor,
    schemaEditor: monaco.editor.IStandaloneCodeEditor,
    outputEditor: monaco.editor.IStandaloneCodeEditor
  ) {
    this.ovEditor = ovlEditor;
    this.outputEditor = outputEditor;
    this.schemaEditor = schemaEditor;

    // install Monaco language client services
    this.monacoServices = MonacoServices.install(ovlEditor);

    // create the web socket
    const url = this.createUrl("/ovLanguage");
    const webSocket = this.createWebSocket(url);

    // listen when the web socket is opened
    listen({
      webSocket,
      onConnection: async connection => {
        // creates and starts the language client
        const languageClient = this.createLanguageClient(connection);

        const disposable = languageClient.start();
        connection.onClose(() => disposable.dispose());
        await languageClient.onReady;
      }
    });
  }

  private static ovEditor: monaco.editor.IStandaloneCodeEditor;
  private static outputEditor: monaco.editor.IStandaloneCodeEditor;
  private static schemaEditor: monaco.editor.IStandaloneCodeEditor;
  private static monacoServices: MonacoServices;
  private static currentConnection: IConnection;

  /**
   * Creates the MonacoLanguageClient which is the language-client
   *  and communicates with the language-server
   *
   * @private
   * @static
   * @param {MessageConnection} connection connection to the language-server
   * @returns {MonacoLanguageClient} created client
   * @memberof LspClient
   */
  private static createLanguageClient(
    connection: MessageConnection
  ): MonacoLanguageClient {
    const client = new MonacoLanguageClient({
      name: "openVALIDATION Language Client",
      clientOptions: {
        // use a language id as a document selector
        documentSelector: ["ov"],

        // disable the default error handler
        errorHandler: {
          error: () => ErrorAction.Continue,
          closed: () => CloseAction.DoNotRestart
        }
      },
      // create a language client connection from the JSON RPC connection on demand
      connectionProvider: {
        get: async (errorHandler, closeHandler) => {
          this.currentConnection = createConnection(
            connection,
            errorHandler,
            closeHandler
          );

          // Informs the server about the initialized schema
          this.sendSchemaChangedNotification();
          this.sendLanguageConfiguration();

          this.addSemanticHighlightingNotificationListener();
          this.addGeneratedCodeNotificationListener();
          this.addDidChangeTextDocumentListener();
          this.addAliasesChangesListener();
          this.setClickHandler();

          return Promise.resolve(this.currentConnection);
        }
      }
    });

    return client;
  }

  /**
   * Adds listener to the notification ``textDocument/semanticHighlighting`` to set a new
   * tokenizer for syntax-highlighting
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static addSemanticHighlightingNotificationListener() {
    // Handler for semantic-highlighting
    this.currentConnection.onNotification(
      NotificationEnum.SemanticHighlighting,
      (params: any) => {
        var jsonParameter = JSON.parse(params) as {
          range: Range;
          pattern: string;
        }[];
        monaco.languages.setTokensProvider(
          "ov",
          createTokenizationSupport(jsonParameter)
        );
      }
    );
  }

  /**
   * Adds listener to the notification ``textDocument/generatedCode`` to reload the code
   * of the code-editor
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static addGeneratedCodeNotificationListener() {
    // Handler for newly generated code
    this.currentConnection.onNotification(
      NotificationEnum.GeneratedCode,
      (params: any) => {
        const paramJson = JSON.parse(params) as ICodeNotification;
        const language = paramJson.language.toLowerCase();
        const value = paramJson.implementation;

        const currentModel = this.outputEditor.getModel();
        if (currentModel) {
          currentModel.setValue(value);
          monaco.editor.setModelLanguage(currentModel, language);
        }
      }
    );
  }

  /**
   * Adds listener to ``onDidChangeTextDocument``-method to inform the server about
   * the changed schema
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static addDidChangeTextDocumentListener() {
    // Handler for changing of the schema
    this.monacoServices.workspace.onDidChangeTextDocument((event: any) => {
      if (event.textDocument.languageId === "yaml") {
        this.sendSchemaChangedNotification();
        ContentManager.setValue(
          ContentEnum.Schema,
          event.textDocument.getText()
        );
      } else if (event.textDocument.languageId === "ov") {
        ContentManager.setValue(ContentEnum.Code, event.textDocument.getText());
      }
    });
  }

  /**
   * Adds listener to the notification ``textDocument/aliasesChanges`` to set a few
   * language-configurations for the ov-language
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static addAliasesChangesListener() {
    // Handler for semantic-highlighting
    this.currentConnection.onNotification(
      NotificationEnum.CommentKeywordChanged,
      (params: string) => {
        monaco.languages.setLanguageConfiguration("ov", {
          comments: {
            lineComment: params as string
          }
        });
      }
    );
  }

  /**
   * Sends the client the current schema and the uri of the active document
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static sendSchemaChangedNotification() {
    const schemaValue = this.schemaEditor.getValue();
    const textdocumentUri = this.ovEditor.getModel()!.uri.toString();
    this.currentConnection.sendNotification(NotificationEnum.SchemaChanged, {
      schema: schemaValue,
      uri: textdocumentUri
    });
  }

  /**
   * Sends the client the culture and language to the server
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static sendLanguageConfiguration() {
    const textdocumentUri = this.ovEditor.getModel()!.uri.toString();

    const cultureSelectBox = document.getElementById(
      "cultureSelectBox"
    ) as HTMLSelectElement;

    if (cultureSelectBox != null) {
      let culture: string = ContentManager.getValue(ContentEnum.Culture);
      for (let index = 0; index < cultureSelectBox.options.length; index++) {
        const element = cultureSelectBox.options[index];
        if (element.value == culture) {
          cultureSelectBox.options[index].selected = true;
          break;
        }
      }

      this.currentConnection.sendNotification(NotificationEnum.CultureChanged, {
        culture: culture,
        uri: textdocumentUri
      });
    }

    const languageSelectBox = document.getElementById(
      "languageSelectBox"
    ) as HTMLSelectElement;

    if (languageSelectBox != null) {
      let language: string = ContentManager.getValue(ContentEnum.Language);
      for (let index = 0; index < languageSelectBox.options.length; index++) {
        const element = languageSelectBox.options[index];
        if (element.value == language) {
          languageSelectBox.options[index].selected = true;
          break;
        }
      }

      this.currentConnection.sendNotification(
        NotificationEnum.LanguageChanged,
        {
          language: language,
          uri: textdocumentUri
        }
      );
    }
  }

  /**
   * Sets the click handler to the select-elements for the langauge and culture
   *
   * @private
   * @static
   * @memberof LspClient
   */
  private static setClickHandler() {
    const cultureSelectBox = document.getElementById(
      "cultureSelectBox"
    ) as HTMLSelectElement;

    if (cultureSelectBox != null) {
      cultureSelectBox.onchange = (e: Event) => {
        if (e != null) {
          const selectedCulture =
            cultureSelectBox.options[cultureSelectBox.selectedIndex].value;
          const textdocumentUri = this.ovEditor.getModel()!.uri.toString();

          ContentManager.setValue(ContentEnum.Culture, selectedCulture);

          this.currentConnection.sendNotification(
            NotificationEnum.CultureChanged,
            { culture: selectedCulture, uri: textdocumentUri }
          );
        }
      };
    }

    const languageSelectBox = document.getElementById(
      "languageSelectBox"
    ) as HTMLSelectElement;

    if (languageSelectBox != null) {
      languageSelectBox.onchange = (e: Event) => {
        if (e != null) {
          const selectedLanguage =
            languageSelectBox.options[languageSelectBox.selectedIndex].value;
          const textdocumentUri = this.ovEditor.getModel()!.uri.toString();

          ContentManager.setValue(ContentEnum.Language, selectedLanguage);

          this.currentConnection.sendNotification(
            NotificationEnum.LanguageChanged,
            { language: selectedLanguage, uri: textdocumentUri }
          );
        }
      };
    }
  }

  /**
   * Creates the URL to the websocket we want to connect to
   *
   * @private
   * @static
   * @param {string} path path of the websocket of the language-server
   * @returns {string} the generated path
   * @memberof LspClient
   */
  private static createUrl(path: string): string {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return normalizeUrl(
      `${protocol}://localhost:${PORT}${location.pathname}${path}`
    );
  }

  /**
   * Generates a websocket to the language-server
   *
   * @private
   * @static
   * @param {string} url url to the language-server
   * @returns {WebSocket} the generated websocket
   * @memberof LspClient
   */
  private static createWebSocket(url: string): WebSocket {
    const socketOptions = {
      maxReconnectionDelay: 10000,
      minReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1.3,
      connectionTimeout: 10000,
      maxRetries: Infinity,
      debug: false
    };
    return new ReconnectingWebSocket(url, undefined, socketOptions) as WebSocket;
  }
}
