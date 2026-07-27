-- Deleted project IDs remain reserved so a Liveblocks room and its bearer
-- tokens can never cross into a later project generation.
ALTER TYPE "ProjectStatus" ADD VALUE 'DELETING';
ALTER TYPE "ProjectStatus" ADD VALUE 'DELETED';
