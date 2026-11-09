import { useState } from "react";
import {
  SquarePen,
  MessageSquare,
  Search,
  Settings,
  Trash2,
  User,
  HelpCircle,
} from "lucide-react";
import Logo from "@workspace/ui/components/logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from "@workspace/ui/components/ui/sidebar";
import { cn } from "@workspace/ui/lib/utils";

type Chat = {
  id: string;
  title: string;
};

const GROUPS: { label: string; chats: Chat[] }[] = [
  {
    label: "Today",
    chats: [
      { id: "today-agent", title: "Design an agent loop" },
      { id: "today-debug", title: "Debug streaming response" },
    ],
  },
  {
    label: "Yesterday",
    chats: [
      { id: "yesterday-models", title: "Comparing models for nimo" },
      { id: "yesterday-theme", title: "Dark mode in the header" },
    ],
  },
  {
    label: "Previous 7 days",
    chats: [
      { id: "week-vite", title: "Migrating web to Vite" },
      { id: "week-ui", title: "shadcn sidebar setup" },
    ],
  },
  {
    label: "Previous 30 days",
    chats: [
      { id: "month-turbo", title: "Turborepo build cache" },
      { id: "month-pnpm", title: "pnpm workspace config" },
    ],
  },
];

export function AppSidebar({
  activeChatId,
  onSelect,
  onNewChat,
  onDelete,
}: {
  activeChatId?: string;
  onSelect?: (id: string) => void;
  onNewChat?: () => void;
  onDelete?: (id: string) => void;
}) {
  const { open } = useSidebar();
  const [query, setQuery] = useState("");

  const normalized = query.trim().toLowerCase();
  const groups = GROUPS.map((group) => ({
    ...group,
    chats: normalized
      ? group.chats.filter((chat) =>
          chat.title.toLowerCase().includes(normalized),
        )
      : group.chats,
  })).filter((group) => group.chats.length > 0);

  return (
    <Sidebar variant="floating" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div
              className={cn(
                "flex items-center gap-2 px-2 py-1.5",
                !open && "justify-center px-0",
              )}
            >
              <Logo size={20} showWordmark={false} />
              {open && (
                <span className="font-medium text-sidebar-foreground">Nimo</span>
              )}
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="New chat"
                  onClick={onNewChat}
                  className="text-sidebar-foreground"
                >
                  <SquarePen />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Search chats">
                  <Search />
                  <span>Search chats</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {open && (
          <div className="px-2 pt-2">
            <SidebarInput
              placeholder="Search chats"
              value={query}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
              className="h-8"
            />
          </div>
        )}

        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.chats.map((chat) => (
                  <SidebarMenuItem key={chat.id}>
                    <SidebarMenuButton
                      isActive={activeChatId === chat.id}
                      tooltip={chat.title}
                      onClick={() => onSelect?.(chat.id)}
                      className="text-sidebar-accent-foreground/80"
                    >
                      <MessageSquare />
                      <span className="truncate">{chat.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      onClick={() => onDelete?.(chat.id)}
                      className="text-sidebar-foreground/60 hover:text-sidebar-foreground"
                    >
                      <Trash2 />
                      <span className="sr-only">Delete {chat.title}</span>
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {normalized && groups.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-sidebar-foreground/50">
            No chats found
          </p>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Help">
              <HelpCircle />
              <span>Help</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Settings">
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Profile">
              <User />
              <span>Profile</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
