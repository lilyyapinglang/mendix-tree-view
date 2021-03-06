import { Component, ReactNode, createElement } from "react";
import { findDOMNode } from "react-dom";

import { TreeViewComponent } from "./components/TreeViewComponent";
import { hot } from "react-hot-loader/root";
import { TreeViewContainerProps } from "../typings/TreeViewProps";

import "./ui/TreeView.scss";
import { NodeStore, NodeStoreConstructorOptions } from "./store/index";
import {
    IAction,
    getObjectContextFromObjects,
    executeMicroflow,
    executeNanoFlow,
    openPage,
    fetchByXpath,
    getObjects,
    createObject,
    deleteObject
} from "@jeltemx/mendix-react-widget-utils";
import { splitRef } from "./utils/index";
import { TitleMethod, EntryObjectExtraOptions, EntryObject } from "./store/objects/entry";
import { getTitleFromObject, ClickCellType } from "./utils/titlehelper";
import { validateProps } from "./utils/validation";
import { commitObject } from "@jeltemx/mendix-react-widget-utils";

export interface Action extends IAction {}
export type ActionReturn = string | number | boolean | mendix.lib.MxObject | mendix.lib.MxObject[] | void;

class TreeView extends Component<TreeViewContainerProps> {
    private store: NodeStore;
    private widgetId?: string;
    private searchEnabled: boolean;

    constructor(props: TreeViewContainerProps) {
        super(props);

        this.bindMethods();

        const parentRef = props.relationType === "nodeParent" ? splitRef(props.relationNodeParent) : null;
        const childRef = props.relationType === "nodeChildren" ? splitRef(props.relationChildReference) : null;
        const hasChildAttr = props.relationNodeParentHasChildAttr !== "" ? props.relationNodeParentHasChildAttr : null;
        const searchNodeRef = props.searchNodeReference !== "" ? splitRef(props.searchNodeReference) : null;
        const relationType = props.relationType;
        const rootAttr = props.nodeIsRootAttr !== "" ? props.nodeIsRootAttr : null;
        const iconAttr = props.uiNodeIconAttr !== "" ? props.uiNodeIconAttr : null;
        const loadFull = props.nodeLoadScenario === "all";

        this.searchEnabled =
            props.searchEnabled &&
            props.nodeLoadScenario === "all" &&
            searchNodeRef !== null &&
            props.searchHelperEntity !== "" &&
            props.searchStringAttribute !== "" &&
            !!props.searchNanoflow.nanoflow;

        const validationMessages = validateProps(props);

        const storeOpts: NodeStoreConstructorOptions = {
            loadFull,
            entryObjectAttributes: {
                childRef,
                parentRef,
                hasChildAttr,
                relationType,
                rootAttr,
                iconAttr
            },
            childLoader: this.fetchChildren,
            validationMessages,
            debug: this.debug
        };

        if (this.searchEnabled) {
            storeOpts.searchHandler = this.search;
        }

        this.store = new NodeStore(storeOpts);
    }

    componentDidUpdate(): void {
        if (this.widgetId) {
            const domNode = findDOMNode(this);
            // @ts-ignore
            domNode.setAttribute("widgetId", this.widgetId);
        }
    }

    componentWillReceiveProps(nextProps: TreeViewContainerProps): void {
        if (!this.widgetId) {
            const domNode = findDOMNode(this);
            // @ts-ignore
            this.widgetId = domNode.getAttribute("widgetId") || undefined;
        }
        this.store.setContext(nextProps.mxObject);
        if (nextProps.mxObject) {
            this.store.setLoading(true);
            this.fetchData(nextProps.mxObject);
        }
    }

    render(): ReactNode {
        const { dragIsDraggable, uiNodeIconIsGlyphicon, uiNodeIconAttr } = this.props;
        const showIcon = uiNodeIconAttr !== "";
        return (
            <TreeViewComponent
                className={this.props.class}
                searchEnabled={this.searchEnabled}
                store={this.store}
                showIcon={showIcon}
                iconIsGlyphicon={uiNodeIconIsGlyphicon}
                draggable={dragIsDraggable}
                onClickHandler={this.clickTypeHandler}
            />
        );
    }

    private bindMethods(): void {
        this.fetchData = this.fetchData.bind(this);
        this.fetchChildren = this.fetchChildren.bind(this);
        this.executeAction = this.executeAction.bind(this);
        this.getTitleMethod = this.getTitleMethod.bind(this);
        this.getClassMethod = this.getClassMethod.bind(this);
        this.clickTypeHandler = this.clickTypeHandler.bind(this);
        this.search = this.search.bind(this);
        this.debug = this.debug.bind(this);
    }

    private async fetchData(object: mendix.lib.MxObject): Promise<void> {
        this.debug("fetchData", object.getGuid());
        const {
            nodeEntity,
            nodeConstraint,
            nodeDataSource,
            nodeGetDataMicroflow,
            nodeGetDataNanoflow,
            nodeLoadScenario
        } = this.props;
        if (!nodeEntity) {
            return;
        }

        let objects: mendix.lib.MxObject[] | null = null;

        try {
            if (nodeDataSource === "xpath" && object) {
                objects = await fetchByXpath(object, nodeEntity, nodeConstraint);
            } else if (nodeDataSource === "microflow" && nodeGetDataMicroflow) {
                objects = (await this.executeAction(
                    { microflow: nodeGetDataMicroflow },
                    false,
                    object
                )) as mendix.lib.MxObject[];
            } else if (nodeDataSource === "nanoflow" && nodeGetDataNanoflow && nodeGetDataNanoflow.nanoflow) {
                objects = (await this.executeAction(
                    { nanoflow: nodeGetDataNanoflow },
                    false,
                    object
                )) as mendix.lib.MxObject[];
            }
        } catch (error) {
            window.mx.ui.error("An error occurred while executing retrieving data: ", error);
        }

        if (objects !== null) {
            const entryOpts: EntryObjectExtraOptions = { titleMethod: this.getTitleMethod() };

            if (nodeLoadScenario === "top") {
                entryOpts.isRoot = true;
            }

            this.store.setEntries(objects, entryOpts);
        } else {
            this.store.setEntries([], {});
        }

        this.store.setLoading(false);
    }

    private async fetchChildren(parentObject: EntryObject): Promise<void> {
        if (this.props.nodeLoadScenario === "all") {
            return;
        }
        this.debug("fetchChildren", parentObject);
        const {
            childScenario,
            childActionMethod,
            childActionMicroflow,
            childActionNanoflow,
            relationType
        } = this.props;

        let objects: mendix.lib.MxObject[] | null = null;

        try {
            this.store.setLoading(true);
            if (
                relationType === "nodeChildren" &&
                childScenario === "reference" &&
                this.store.entryObjectAttributes.childRef
            ) {
                const references = parentObject.mxObject.getReferences(this.store.entryObjectAttributes.childRef);
                objects = await getObjects(references);
            } else if (childScenario === "action" && childActionMethod === "microflow" && childActionMicroflow) {
                objects = (await this.executeAction(
                    { microflow: childActionMicroflow },
                    false,
                    parentObject.mxObject
                )) as mendix.lib.MxObject[];
            } else if (
                childScenario === "action" &&
                childActionMethod === "nanoflow" &&
                childActionNanoflow &&
                childActionNanoflow.nanoflow
            ) {
                objects = (await this.executeAction(
                    { nanoflow: childActionNanoflow },
                    false,
                    parentObject.mxObject
                )) as mendix.lib.MxObject[];
            } else {
                window.mx.ui.info("Cannot load data", false);
            }
        } catch (error) {
            window.mx.ui.error("An error occurred while executing retrieving children: ", error);
        }

        if (objects !== null) {
            const entryOpts: EntryObjectExtraOptions = {
                titleMethod: this.getTitleMethod(),
                parent: parentObject.mxObject.getGuid()
            };

            this.store.setEntries(objects, entryOpts, false);
            parentObject.setLoaded(true);
        } else {
            parentObject.setHasChildren(false);
            parentObject.setLoaded(true);
        }

        this.store.setLoading(false);
    }

    private getTitleMethod(): TitleMethod {
        const renderAsHTML = this.props.uiNodeRenderAsHTML;
        const titleType = this.props.uiNodeTitleType;
        const attribute = this.props.uiNodeTitleAttr;
        const nanoflow = this.props.uiNodeTitleNanoflow;

        return (obj: mendix.lib.MxObject): Promise<ReactNode> =>
            getTitleFromObject(obj, {
                attribute,
                executeAction: this.executeAction,
                nanoflow,
                titleType,
                renderAsHTML
            });
    }

    private getClassMethod(attr: string): (obj: mendix.lib.MxObject) => string {
        return (obj: mendix.lib.MxObject): string => {
            if (!obj || !attr) {
                return "";
            }
            return obj.get(attr) as string;
        };
    }

    private async clickTypeHandler(obj: mendix.lib.MxObject, clickType: ClickCellType = "single"): Promise<void> {
        if (!obj || this.props.eventNodeClickFormat !== clickType) {
            return;
        }

        const action: Action = {};

        if (this.props.eventNodeOnClickAction === "open" && this.props.eventNodeOnClickForm) {
            action.page = {
                pageName: this.props.eventNodeOnClickForm,
                openAs: this.props.eventNodeOnClickOpenPageAs
            };
        } else if (this.props.eventNodeOnClickAction === "microflow" && this.props.eventNodeOnClickMicroflow) {
            action.microflow = this.props.eventNodeOnClickMicroflow;
        } else if (this.props.eventNodeOnClickAction === "nanoflow" && this.props.eventNodeOnClickNanoflow.nanoflow) {
            action.nanoflow = this.props.eventNodeOnClickNanoflow;
        }

        if (
            typeof action.microflow !== "undefined" ||
            typeof action.nanoflow !== "undefined" ||
            typeof action.page !== "undefined"
        ) {
            this.executeAction(action, true, obj);
        }
    }

    private async search(query: string): Promise<mendix.lib.MxObject[] | null> {
        const { searchNanoflow } = this.props;

        if (!searchNanoflow) {
            window.mx.ui.error("Cannot create search, nanoflow undefined");
            return null;
        }

        const helper = await this.createSearchHelper(query);

        if (helper === null) {
            window.mx.ui.error("Cannot create search Helper entity!");
            return null;
        }

        const objects = (await this.executeAction({ nanoflow: searchNanoflow }, true, helper)) as mendix.lib.MxObject[];
        deleteObject(helper);

        return objects;
    }

    private async createSearchHelper(query: string): Promise<mendix.lib.MxObject | null> {
        const { searchHelperEntity, searchNodeReference, searchStringAttribute } = this.props;
        const searchNodeRef = searchNodeReference !== "" ? splitRef(searchNodeReference) : null;

        if (!searchHelperEntity || !searchNodeRef || !searchStringAttribute) {
            window.mx.ui.error("Cannot create search Helper entity!");
            return null;
        }

        const helperObject = await createObject(searchHelperEntity);
        const nodeGuids = this.store.entries.map(e => e.guid);

        if (searchNodeRef) {
            helperObject.addReferences(searchNodeRef, nodeGuids);
        }

        if (searchStringAttribute) {
            helperObject.set(searchStringAttribute, query);
        }

        await commitObject(helperObject);

        return helperObject;
    }

    private executeAction(action: Action, showError = false, obj?: mendix.lib.MxObject): Promise<ActionReturn> {
        this.debug("executeAction", action, obj && obj.getGuid());
        const { mxform } = this.props;
        const context = getObjectContextFromObjects(obj, this.props.mxObject);

        if (action.microflow) {
            return executeMicroflow(action.microflow, context, mxform, showError);
        } else if (action.nanoflow) {
            return executeNanoFlow(action.nanoflow, context, mxform, showError);
        } else if (action.page) {
            return openPage(action.page, context, showError);
        }

        return Promise.reject(
            new Error(`No microflow/nanoflow/page defined for this action: ${JSON.stringify(action)}`)
        );
    }

    private debug(...args: unknown[]): void {
        const id = this.props.friendlyId || this.widgetId;
        if (window.logger) {
            window.logger.debug(`${id}:`, ...args);
        }
    }
}

export default hot(TreeView);
