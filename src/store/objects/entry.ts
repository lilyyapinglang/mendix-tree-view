import { computed, flow, observable, action, toJS } from "mobx";
import { ReactNode } from "react";
import { EntryObjectAttributes } from "..";
import { commitObject } from "@jeltemx/mendix-react-widget-utils";

export type TitleMethod = ((obj: mendix.lib.MxObject) => Promise<ReactNode | string>) | null;
export type ClassMethod = ((obj: mendix.lib.MxObject) => string) | null;

export interface TreeObject {
    guid: string;
    parent: string;
    children: string[];
    hasChildren: boolean;
    title: string;
    root: boolean;
    selected: boolean;
    expanded: boolean;
    canExpand?: boolean;
    icon: string | null;
    highlight?: boolean;
}

export interface EntryObjectExtraOptions {
    titleMethod?: TitleMethod;
    classMethod?: ClassMethod;
    isRoot?: boolean;
    parent?: string;
}

export interface EntryObjectOptions {
    mxObject: mendix.lib.MxObject;
    changeHandler?: (guid?: string, removedCb?: (removed: boolean) => void) => void | Promise<void>;
    extraOpts: EntryObjectExtraOptions;
}

export class EntryObject {
    public _type = "EntryObject";
    public _obj: mendix.lib.MxObject;
    public _subscriptions: number[];
    public _changeHandler: (guid?: string, removedCb?: (removed: boolean) => void) => void;

    public _attributes: EntryObjectAttributes;
    public _titleMethod: TitleMethod;
    public _classMethod: ClassMethod;

    @observable _title: string;
    @observable _icon: string | null;
    @observable _class: string;
    @observable _selected: boolean;
    @observable _parent: string;
    @observable _children: string[];
    @observable _hasChildren: boolean;
    @observable _isLoaded: boolean;
    @observable _isExpanded: boolean;
    @observable _isRoot: boolean;

    fixTitle = flow(function*(this: EntryObject) {
        if (this._titleMethod) {
            const title = yield this._titleMethod(this._obj);
            // @ts-ignore
            this._title = title;
        }
    });

    constructor(opts: EntryObjectOptions, attributes: EntryObjectAttributes) {
        const { mxObject, changeHandler, extraOpts } = opts;
        const { titleMethod, classMethod, isRoot, parent } = extraOpts;
        this._obj = mxObject;

        this._title = "";
        this._icon = null;
        this._class = "";
        this._selected = false;
        this._parent = typeof parent !== "undefined" ? parent : "";
        this._children = [];
        this._hasChildren = false;
        this._isLoaded = false;
        this._isExpanded = false;
        this._isRoot = typeof isRoot !== "undefined" ? isRoot : false;
        this._titleMethod = titleMethod || null;
        this._classMethod = classMethod || null;
        this._changeHandler = changeHandler || ((): void => {});
        this._subscriptions = [];
        this._attributes = attributes;

        if (!changeHandler) {
            console.warn("No changehandler for ", opts);
        }

        if (titleMethod) {
            this.fixTitle();
        }

        if (classMethod) {
            this.fixClass();
        }

        this.resetSubscription();
        this.setAttributes();
    }

    @action
    setAttributes(): void {
        const attr = this._attributes;
        if (attr.relationType === "nodeParent" && attr.parentRef !== null) {
            const parentRef = this._obj.getReference(attr.parentRef);
            if (parentRef) {
                this.setParent(parentRef);
            }
        } else if (attr.relationType === "nodeChildren" && attr.childRef !== null) {
            const childRefs = this._obj.getReferences(attr.childRef);
            this.setChildren(childRefs);
        }

        if (attr.rootAttr) {
            const isRoot = this._obj.get(attr.rootAttr) as boolean;
            this.setRoot(isRoot);
        }

        if (attr.iconAttr) {
            const icon = this._obj.get(attr.iconAttr) as string;
            this.setIcon(icon);
        }

        if (attr.hasChildAttr) {
            const hasChildren = this._obj.get(attr.hasChildAttr) as boolean;
            this.setHasChildren(hasChildren);
        }
    }

    @action
    clearSubscriptions(): void {
        const { unsubscribe } = window.mx.data;
        this._subscriptions.forEach(subscription => unsubscribe(subscription));
        this._subscriptions = [];
    }

    @action
    fixClass(): void {
        if (this._classMethod) {
            this._class = this._classMethod(this._obj);
        }
    }

    @action
    resetSubscription(): void {
        const { subscribe } = window.mx.data;
        this.clearSubscriptions();
        if (this._obj) {
            const subscription = subscribe({
                guid: this._obj.getGuid(),
                callback: guid => {
                    if (window.logger) {
                        window.logger.debug(`TreeView subscription fired: ${this._type} || ${guid}`);
                    }
                    this._changeHandler(`${guid}`, removed => {
                        if (removed) {
                            if (window.logger) {
                                window.logger.debug(`Removed: ${this._type} || ${guid}`);
                            }
                        } else {
                            this.setAttributes();
                            this.fixTitle();
                        }
                    });
                }
            });
            this._subscriptions.push(subscription);
        }
    }

    @computed
    get title(): string {
        return this._title;
    }

    @computed
    get selected(): boolean {
        return this._selected;
    }

    @computed
    get parent(): string {
        return this._parent;
    }

    @computed
    get children(): string[] {
        return this._children;
    }

    @computed
    get hasChildren(): boolean {
        return this._hasChildren;
    }

    @computed
    get icon(): string | null {
        return this._icon;
    }

    @computed
    get isRoot(): boolean {
        return this._isRoot;
    }

    @computed
    get isLoaded(): boolean {
        return this._isLoaded;
    }

    @computed
    get isExpanded(): boolean {
        return this._isExpanded;
    }

    @computed
    get className(): string {
        return this._class;
    }

    @computed
    get guid(): string {
        return this._obj.getGuid();
    }

    @computed
    get mxObject(): mendix.lib.MxObject {
        return this._obj;
    }

    @computed
    get obj(): TreeObject {
        return {
            title: this.title,
            guid: this.guid,
            parent: this.parent,
            children: toJS(this.children),
            hasChildren: this.hasChildren,
            root: this.isRoot,
            selected: this.selected,
            expanded: this.isExpanded,
            icon: this.icon
        };
    }

    @action
    setSelected(state = false): void {
        this._selected = state;
    }

    @action
    setParent(guid = "", updateObject = false): void {
        this._parent = guid;

        if (updateObject) {
            const attr = this._attributes;
            if (attr.relationType === "nodeParent" && attr.parentRef !== null) {
                this._obj.set(attr.parentRef, guid);
                commitObject(this._obj);
            }
        }
    }

    @action
    setChildren(guids: string[] = []): void {
        this._children = guids;
    }

    @action
    setHasChildren(hasChildren = false): void {
        this._hasChildren = hasChildren;
    }

    @action
    setLoaded(loaded = false): void {
        this._isLoaded = loaded;
    }

    @action
    setExpanded(expanded = false): void {
        this._isExpanded = expanded;
    }

    @action
    setRoot(isRoot = false): void {
        this._isRoot = isRoot;
    }

    @action
    setIcon(str = ""): void {
        this._icon = str === "" ? null : str;
    }
}
